// Domain vocabulary prompt ensuring zero hallucination on critical Seshank AI Labs terms
export const SESHANK_AI_LABS_VOCABULARY_PROMPT =
  "Seshank, Seshank AI Labs, Jev, Mesh API, Vineet Pinto, Analytics Depot, " +
  "AI SDR, AI Receptionist, AI Ops Copilot, AI Support Agent, Custom Workflow Agent, " +
  "founder website, high-profile founder, B2B SaaS, outbound, Apollo, Tavily, " +
  "Serper, SerpAPI, Riyadh, Jeddah, Khobar, Dammam, Dubai, Abu Dhabi, KSA, UAE, UK, US, " +
  "ICP, cold email, permission-first, sniper sheet, Green Light gate.";

export interface GroqWhisperResponse {
  text: string;
}

export async function transcribeAudio(
  audioBlob: Blob | File | Buffer,
  filename: string = "recording.webm"
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not defined in environment.");
  }

  const model = process.env.GROQ_WHISPER_MODEL || "whisper-large-v3-turbo";
  const formData = new FormData();

  if (audioBlob instanceof Blob || audioBlob instanceof File) {
    formData.append("file", audioBlob, filename);
  } else {
    const uint8 = new Uint8Array(audioBlob);
    const blob = new Blob([uint8], { type: filename.endsWith(".mp4") ? "audio/mp4" : "audio/webm" });
    formData.append("file", blob, filename);
  }

  formData.append("model", model);
  formData.append("temperature", "0");
  formData.append("response_format", "json");
  formData.append("prompt", SESHANK_AI_LABS_VOCABULARY_PROMPT);

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq Whisper API failed with status ${response.status}: ${errorText}`);
  }

  const result: GroqWhisperResponse = await response.json();
  return result.text ? result.text.trim() : "";
}
