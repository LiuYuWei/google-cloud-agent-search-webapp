# Google Cloud Agent Search Web App

以 Next.js 打造的範例應用，串接 Google Cloud **Vertex AI Search**（Discovery Engine），
讓學生能根據你自備的文件（PDF / PPTX / HTML）取得有依據的答案。

後端呼叫 Discovery Engine 的 **Answer API** 並搭配 **Sessions** 支援多輪對話，
前端則會顯示行內引用標記與參考來源面板。

> English version: [README.md](./README.md)

## 架構

```
瀏覽器 ──▶ /api/chat (Next.js route) ──▶ Discovery Engine answerQuery + Session
                                  │
                                  └─▶ Engine: <your-engine-id>
                                      Data Store: <your-data-store-id>
                                      （從 GCS bucket 匯入文件）
```

- **驗證**：使用 Application Default Credentials (ADC)。本機請執行
  `gcloud auth application-default login`；部署到 Cloud Run 時會自動取用 runtime
  service account，程式碼不需改動。
- **Sessions**：第一輪建立 session，後續回合沿用，由 Discovery Engine 負責
  query rewriting 與上下文管理。

## 環境需求

- Node.js 20 以上（已在 24 上測試）
- 已登入 `gcloud` CLI，且專案中有一個 Vertex AI Search engine，
  至少包含一個已索引文件的 Data Store

## 安裝

```bash
npm install
cp .env.local.example .env.local
# 編輯 .env.local，填入你的 project / engine ID
```

登入本機 ADC、設定 quota project，並啟用 API：

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project <PROJECT_ID>
gcloud services enable discoveryengine.googleapis.com --project <PROJECT_ID>
```

## 本機執行

```bash
npm run dev
```

開啟 http://localhost:3000。

## 環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `GCP_PROJECT_ID` | （必填） | 擁有該 engine 的 GCP 專案 |
| `DISCOVERY_ENGINE_LOCATION` | `global` | `global`、`us` 或 `eu` |
| `DISCOVERY_ENGINE_COLLECTION` | `default_collection` | |
| `DISCOVERY_ENGINE_ID` | （必填） | Engine ID，例如 `your-engine_1234567890` |
| `DISCOVERY_ENGINE_SERVING_CONFIG` | `default_search` | |
| `ANSWER_PREAMBLE` | （內建） | 覆寫系統提示，預設為台灣繁體中文 preamble |

## 部署到 Cloud Run

```bash
PROJECT_ID=<your-project>
REGION=us-central1
SERVICE=rag-demo

gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE

gcloud run deploy $SERVICE \
  --image gcr.io/$PROJECT_ID/$SERVICE \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars GCP_PROJECT_ID=$PROJECT_ID,DISCOVERY_ENGINE_ID=<engine-id>
```

Cloud Run 的 runtime service account 需要 **Discovery Engine Viewer** 角色
（或同等的自訂角色，允許 `discoveryengine.servingConfigs.answer` 與
`discoveryengine.sessions.*`）。

## 檔案結構

- `app/page.tsx` — 聊天介面，含行內引用與參考來源面板
- `app/api/chat/route.ts` — POST 端點，接受 `{query, sessionName?, userPseudoId}`
- `lib/discoveryEngine.ts` — Discovery Engine client 包裝（sessions + answer）
- `Dockerfile` — Cloud Run 用的 Next.js standalone build
- `next.config.ts` — `output: "standalone"`
