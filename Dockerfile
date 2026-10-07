# ---- Dependencies ----
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build ----
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Runtime ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Python 3 for the Racing scripts, isolated in a venv to avoid Debian's
# "externally managed environment" restriction on the system interpreter.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Next.js standalone server output
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Scripts invoked via execFile('python', ...) at runtime
COPY app.py GetBankFromRoutingNumber.py GT3_Car_Data.xlsx Track_Information.xlsx ./

COPY src/intro_transformer.py ./src/intro_transformer.py
COPY src/SampleDealGPT.py ./src/SampleDealGPT.py
COPY src/prompts.py ./src/prompts.py
COPY src/chatbot_logging.py ./src/chatbot_logging.py
COPY src/simple_rag.py ./src/simple_rag.py
COPY src/racecar_analysis_rag.py ./src/racecar_analysis_rag.py

EXPOSE 10000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
