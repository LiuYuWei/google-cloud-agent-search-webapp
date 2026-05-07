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
      promptSpec: {
        preamble:
          "你是一個專業的學生問答助理。請根據提供的資料，用繁體中文清楚、有條理地回答學生的問題。如果資料中沒有相關資訊，請誠實說明。",
      },
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
