import { ConversationalSearchServiceClient } from "@google-cloud/discoveryengine";

const PROJECT_ID = process.env.GCP_PROJECT_ID!;
const LOCATION = process.env.DISCOVERY_ENGINE_LOCATION ?? "global";
const COLLECTION = process.env.DISCOVERY_ENGINE_COLLECTION ?? "default_collection";
const ENGINE_ID = process.env.DISCOVERY_ENGINE_ID!;
const SERVING_CONFIG_ID = process.env.DISCOVERY_ENGINE_SERVING_CONFIG ?? "default_search";

if (!PROJECT_ID || !ENGINE_ID) {
  throw new Error(
    "Missing required env vars: GCP_PROJECT_ID and DISCOVERY_ENGINE_ID must be set",
  );
}

const apiEndpoint =
  LOCATION === "global"
    ? "discoveryengine.googleapis.com"
    : `${LOCATION}-discoveryengine.googleapis.com`;

const DEFAULT_PREAMBLE = `你是一個專業的學生問答助理，你的任務是依據檢索到的資料來回答學生的問題。

**回答語言規範（最重要，務必嚴格遵守）：**
- 一律使用「台灣繁體中文」回答，不可使用簡體字。
- 用詞需符合台灣慣用習慣，例如：軟體（非軟件）、資料（非數據）、網路（非網絡）、檔案（非文件）、影片（非視頻）、解析度（非分辨率）、滑鼠（非鼠標）、品質（非質量）、程式（非程序）、頻道（非頻道/通道時依語境）、伺服器（非服務器）、資訊（非信息）。
- 若檢索到的原始資料含有簡體中文，請在回答時轉換為台灣繁體中文與用語。

**回答格式與態度：**
- 答案要清楚、有條理，善用 Markdown 標題、項目符號、粗體強調重點。
- 優先依據檢索到的資料作答；若資料中沒有相關資訊，請誠實說明「依據目前資料無法回答」，不要編造內容。
- 涉及醫療、用藥、法律等專業議題時，提醒使用者實際情況請諮詢專業人員。`;

const PREAMBLE = process.env.ANSWER_PREAMBLE ?? DEFAULT_PREAMBLE;

let cachedClient: ConversationalSearchServiceClient | null = null;

function getClient(): ConversationalSearchServiceClient {
  if (!cachedClient) {
    cachedClient = new ConversationalSearchServiceClient({
      apiEndpoint,
      projectId: PROJECT_ID,
      // REST transport — gRPC fails when bundled by Turbopack/Next.js dev.
      fallback: true,
    });
  }
  return cachedClient;
}

const enginePath =
  `projects/${PROJECT_ID}/locations/${LOCATION}` +
  `/collections/${COLLECTION}/engines/${ENGINE_ID}`;

const servingConfigPath = `${enginePath}/servingConfigs/${SERVING_CONFIG_ID}`;

export async function createSession(userPseudoId: string): Promise<string> {
  const client = getClient();
  const [session] = await client.createSession({
    parent: enginePath,
    session: { userPseudoId },
  });
  if (!session.name) {
    throw new Error("createSession returned without a session name");
  }
  return session.name;
}

export type Citation = {
  startIndex: number;
  endIndex: number;
  sourceIndices: number[];
};

export type Reference = {
  index: number;
  title: string;
  uri: string;
  snippet: string;
};

export type AnswerResult = {
  answerText: string;
  citations: Citation[];
  references: Reference[];
  sessionName: string;
};

export async function answer(params: {
  query: string;
  sessionName?: string;
  userPseudoId: string;
}): Promise<AnswerResult> {
  const client = getClient();

  const sessionName =
    params.sessionName ?? (await createSession(params.userPseudoId));

  const [response] = await client.answerQuery({
    servingConfig: servingConfigPath,
    query: { text: params.query },
    session: sessionName,
    answerGenerationSpec: {
      includeCitations: true,
      modelSpec: { modelVersion: "stable" },
      promptSpec: { preamble: PREAMBLE },
    },
  });

  const answerObj = response.answer ?? {};

  const citations: Citation[] = (answerObj.citations ?? []).map((c) => ({
    startIndex: Number(c.startIndex ?? 0),
    endIndex: Number(c.endIndex ?? 0),
    sourceIndices: (c.sources ?? []).map((s) => Number(s.referenceId ?? 0)),
  }));

  const references: Reference[] = (answerObj.references ?? []).map((r, idx) => {
    const chunkInfo = r.chunkInfo;
    const unstructured = r.unstructuredDocumentInfo;
    if (chunkInfo) {
      return {
        index: idx,
        title: chunkInfo.documentMetadata?.title ?? "(untitled)",
        uri: chunkInfo.documentMetadata?.uri ?? "",
        snippet: chunkInfo.content ?? "",
      };
    }
    if (unstructured) {
      const firstChunk = unstructured.chunkContents?.[0];
      return {
        index: idx,
        title: unstructured.title ?? "(untitled)",
        uri: unstructured.uri ?? "",
        snippet: firstChunk?.content ?? "",
      };
    }
    return { index: idx, title: "(untitled)", uri: "", snippet: "" };
  });

  return {
    answerText: answerObj.answerText ?? "",
    citations,
    references,
    sessionName,
  };
}
