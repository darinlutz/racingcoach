import { execFile } from 'node:child_process';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { AI_OUT_OF_CREDITS, isAiOutOfCredits } from './aiErrors';

const LLM_TYPES = ['openai', 'ollama'];
const EMBEDDING_TYPES = ['openai', 'chroma', 'nomic'];

export const isLlmType = (value: unknown): value is string => LLM_TYPES.includes(value as string);
export const isEmbeddingType = (value: unknown): value is string =>
  EMBEDDING_TYPES.includes(value as string);

// The Ollama LLM and Nomic embedding options talk to a local Ollama server,
// which doesn't exist on hosted deployments, so the UI asks whether one is
// reachable before offering them.
export async function ollamaAvailabilityResponse() {
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(1500),
    });
    return NextResponse.json({ ollamaAvailable: response.ok });
  } catch {
    return NextResponse.json({ ollamaAvailable: false });
  }
}

// Runs a Python script in src/ with a JSON payload argument and resolves with
// the JSON object it prints. Rejects with the script's error message.
export function runPythonJson<T extends { error?: string }>(
  scriptFile: string,
  payload: unknown,
  timeoutMs = 60000
): Promise<T> {
  const scriptPath = path.join(process.cwd(), 'src', scriptFile);

  return new Promise<T>((resolve, reject) => {
    execFile(
      'python',
      [scriptPath, JSON.stringify(payload)],
      {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        let parsed: T | undefined;
        try {
          parsed = JSON.parse(stdout.trim());
        } catch {
          parsed = undefined;
        }

        if (parsed?.error) {
          reject(new Error(parsed.error));
          return;
        }

        if (error) {
          let message = stderr.trim() || error.message;
          try {
            message = JSON.parse(stderr.trim()).error || message;
          } catch {
            // stderr wasn't the script's JSON error; keep the raw text.
          }
          reject(new Error(message));
          return;
        }

        if (!parsed) {
          reject(new Error('Script returned no result'));
          return;
        }

        resolve(parsed);
      }
    );
  });
}

// Builds the GET/POST handlers for a RAG tab backed by a Python script in
// src/ that accepts a JSON payload argument and prints a JSON result.
export function createRagRoute(scriptFile: string, timeoutMs = 60000) {
  async function GET() {
    return ollamaAvailabilityResponse();
  }

  async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query.trim() : '';

    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    const llmType = isLlmType(body.llmType) ? body.llmType : 'openai';
    const embeddingType = isEmbeddingType(body.embeddingType) ? body.embeddingType : 'openai';

    try {
      const result = await runPythonJson<{ response?: string; references?: string[]; error?: string }>(
        scriptFile,
        { query, llmType, embeddingType },
        timeoutMs
      );

      if (!result.response) {
        return NextResponse.json({ error: 'Script returned no response' }, { status: 500 });
      }

      return NextResponse.json({ response: result.response, references: result.references ?? [] });
    } catch (error) {
      if (isAiOutOfCredits(error)) {
        return NextResponse.json({ error: AI_OUT_OF_CREDITS }, { status: 503 });
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Script failed' },
        { status: 500 }
      );
    }
  }

  return { GET, POST };
}
