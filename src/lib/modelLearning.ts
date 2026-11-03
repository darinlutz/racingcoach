import { execFile } from 'node:child_process';
import path from 'node:path';
import { isAdmin } from './roles';

// The Model Learning page (src/app/model-learning/) is for Admins and this account only
const MODEL_LEARNING_ACCOUNTS = new Set(['darinlutz648@gmail.com']);

export const canUseModelLearning = (user: { role: string; emailAddress: string }) =>
  isAdmin(user.role) || MODEL_LEARNING_ACCOUNTS.has(user.emailAddress.toLowerCase());

// Runs src/day_1_tensors.py and resolves with everything it printed, stdout then stderr (an error's traceback is
// part of the lesson). Rejects only when Python can't be started or the script times out
export function runModelLearning(timeoutMs = 120000): Promise<{ output: string; exitCode: number }> {
  const scriptPath = path.join(process.cwd(), 'src', 'day_1_tensors.py');
  return new Promise((resolve, reject) => {
    execFile(
      'python',
      [scriptPath],
      { env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && (error.killed || typeof error.code !== 'number')) {
          reject(new Error(error.killed ? 'The script timed out' : error.message));
          return;
        }
        resolve({ output: [stdout, stderr].filter((s) => s.trim()).join('\n'), exitCode: error ? Number(error.code) : 0 });
      }
    );
  });
}
