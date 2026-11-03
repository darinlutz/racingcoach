import contextlib
import io
import json
import sys
import chromadb
from chromadb.utils import embedding_functions
from openai import OpenAI
import os
from pathlib import Path
from dotenv import load_dotenv

# load_dotenv() with no arguments only looks for a file literally named
# ".env", but this project keeps its keys (OPENAI_API_KEY, etc.) in
# ".env.local" at the project root. Point at it explicitly, and resolve the
# path relative to this file so it works no matter what directory the
# script is run from.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

api_key = os.getenv("OPENAI_API_KEY")


class EmbeddingModel:
    def __init__(self, model_type="openai"):
        self.model_type = model_type
        if model_type == "openai":
            self.client = OpenAI(api_key=api_key)
            self.embedding_fn = embedding_functions.OpenAIEmbeddingFunction(
                api_key=api_key,
                model_name="text-embedding-3-small",
            )
        elif model_type == "chroma":
            self.embedding_fn = embedding_functions.DefaultEmbeddingFunction()
        elif model_type == "nomic":
            # using Ollama nomic-embed-text model
            self.embedding_fn = embedding_functions.OpenAIEmbeddingFunction(
                api_key="ollama",
                api_base="http://localhost:11434/v1",
                model_name="nomic-embed-text",
            )

class LLMModel:
    def __init__(self, model_type="openai"):
        self.model_type = model_type
        if model_type == "openai":
            self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            self.model_name = "gpt-4o-mini"
        else:
            self.client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")
            self.model_name = "llama3.2"

    def generate_completion(self, messages):
        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                temperature=0.0,  # 0.0 is deterministic
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"Error generating response: {str(e)}"


def select_models():
    # Select LLM Model
    print("\nSelect LLM Model:")
    print("1. OpenAI GPT-4")
    print("2. Ollama Llama2")
    while True:
        choice = input("Enter choice (1 or 2): ").strip()
        if choice in ["1", "2"]:
            llm_type = "openai" if choice == "1" else "ollama"
            break
        print("Please enter either 1 or 2")

    # Select Embedding Model
    print("\nSelect Embedding Model:")
    print("1. OpenAI Embeddings")
    print("2. Chroma Default")
    print("3. Nomic Embed Text (Ollama)")
    while True:
        choice = input("Enter choice (1, 2, or 3): ").strip()
        if choice in ["1", "2", "3"]:
            embedding_type = {"1": "openai", "2": "chroma", "3": "nomic"}[choice]
            break
        print("Please enter 1, 2, or 3")

    return llm_type, embedding_type



FEET_PER_MILE = 5280
METERS_PER_FOOT = 0.3048
KPH_PER_MPH = 1.609344
NM_PER_LB_FT = 1.3558179483


def load_cars(cars, units="standard"):
    """Turn each car of Car Data (racingcoach."Cars", which the website sends as the payload's cars) into one text
    document describing that car, with its torque in the user's Preferred Units: lb-ft (standard) or Nm (metric).
    Specs a car doesn't have are left out."""
    documents = []
    for car in cars:
        specs = []

        def spec(key, text):
            if car.get(key) is not None:
                specs.append(text.format(car[key]))

        spec("racingDiscipline", "racing discipline {}")
        spec("lengthIn", "length {} in")
        spec("widthIn", "width {} in")
        spec("wheelbaseIn", "wheelbase {} in")
        spec("dryWeightLbs", "dry weight {} lbs")
        spec("wetWeightLbs", "wet weight with driver {} lbs")
        spec("displacementLiters", "engine displacement {} liters")
        spec("rpmLimit", "RPM limit {}")
        if car.get("torqueLbFt") is not None:
            torque = car["torqueLbFt"]
            specs.append(f"torque {torque * NM_PER_LB_FT:.0f} Nm" if units == "metric" else f"torque {torque} lb-ft")
        spec("powerBhp", "power {} bhp")
        if car.get("powerBhp") and car.get("wetWeightLbs"):
            specs.append(f"power-to-weight {car['powerBhp'] / car['wetWeightLbs']:.3f} bhp per lb (wet weight)")
        notes = car.get("notes") or ""
        documents.append(
            f"Car: {car['name']}: " + (", ".join(specs) if specs else "no specs recorded") + "."
            + (f" Notes: {notes}" if notes else "")
        )
    print(f"\nLoaded {len(documents)} cars:")
    for doc in documents:
        print(f"- {doc}")
    return documents


def load_tracks(tracks, units="standard"):
    """Turn each Track Data track (racingcoach."Tracks", which the website sends as the payload's tracks) into one
    text document describing that track, in the user's Preferred Units: feet, miles and mph (standard) or meters, km
    and kph (metric). Details a track doesn't have are left out."""
    documents = []
    for track in tracks:
        details = []
        if track.get("category"):
            details.append(f"track type {track['category']}")
        length_ft = track.get("lengthFeet")
        corners = track.get("numberOfCorners")
        speed_mph = track.get("averageSpeedMph")
        if units == "metric":
            length_km = length_ft * METERS_PER_FOOT / 1000 if length_ft else None
            if length_ft:
                details.append(f"length {length_ft * METERS_PER_FOOT:.0f} m ({length_km:.2f} km)")
            if corners:
                details.append(
                    f"{corners} corners" + (f" ({corners / length_km:.1f} corners per km)" if length_km else "")
                )
            if speed_mph:
                details.append(f"average speed {speed_mph * KPH_PER_MPH:.0f} kph")
        else:
            length_miles = length_ft / FEET_PER_MILE if length_ft else None
            if length_ft:
                details.append(f"length {length_ft} ft ({length_miles:.2f} miles)")
            if corners:
                details.append(
                    f"{corners} corners" + (f" ({corners / length_miles:.1f} corners per mile)" if length_miles else "")
                )
            if speed_mph:
                details.append(f"average speed {speed_mph} mph")
        if track.get("typicalLapSeconds"):
            details.append(f"typical lap time {track['typicalLapSeconds']} seconds")
        notes = track.get("notes") or ""
        documents.append(
            f"Track: {track['name']} (track ID: {track['key']}): "
            + (", ".join(details) if details else "no details recorded")
            + "."
            + (f" Track notes: {notes}" if notes else "")
        )
    print(f"\nLoaded {len(documents)} tracks:")
    for doc in documents:
        print(f"- {doc}")
    return documents


def load_documents(cars, tracks, units="standard"):
    """Cars and tracks share one collection; the metadata records which is which
    so the prompt can present them as separate sections."""
    cars = load_cars(cars, units)
    tracks = load_tracks(tracks, units)
    documents = cars + tracks
    metadatas = [{"type": "car"}] * len(cars) + [{"type": "track"}] * len(tracks)
    return documents, metadatas


def setup_chromadb(documents, metadatas, embedding_model):
    client = chromadb.Client()

    try:
        client.delete_collection("racecar_data")
    except:
        pass

    collection = client.create_collection(
        name="racecar_data", embedding_function=embedding_model.embedding_fn
    )

    # ChromaDB refuses an empty add, e.g. the terminal demo's
    if documents:
        collection.add(
            documents=documents,
            metadatas=metadatas,
            ids=[str(i) for i in range(len(documents))],
        )

    print("\nDocuments added to ChromaDB collection successfully!")
    return collection


def find_related_chunks(query, collection, top_k=2):
    results = collection.query(query_texts=[query], n_results=top_k)

    print("\nRelated chunks found:")
    for doc in results["documents"][0]:
        print(f"- {doc}")

    return list(
        zip(
            results["documents"][0],
            (
                results["metadatas"][0]
                if results["metadatas"][0]
                else [{}] * len(results["documents"][0])
            ),
        )
    )


def augment_prompt(query, related_chunks):
    cars = [doc for doc, meta in related_chunks if meta.get("type") == "car"]
    tracks = [doc for doc, meta in related_chunks if meta.get("type") == "track"]

    car_section = "\n".join(f"- {doc}" for doc in cars)
    track_section = "\n".join(f"- {doc}" for doc in tracks)
    augmented_prompt = (
        f"CAR DATA:\n{car_section}\n\n"
        f"TRACK DATA:\n{track_section}\n\n"
        f"Question: {query}\n"
        "(Use both data sets plus your general knowledge, but mention only the few cars and tracks "
        "that matter to this question rather than listing every row.)\nAnswer:"
    )

    print("\nAugmented prompt:")
    print(augmented_prompt)

    return augmented_prompt


SYSTEM_PROMPT = (
    "You are an expert racecar and circuit analyst. Each question comes with two data sets: CAR DATA "
    "(specs for each car, its racing discipline (e.g. Sports Car, Prototype, Formula Car), plus Notes describing its layout, handling and strengths/weaknesses) and TRACK DATA (length, corner count, average speed and typical lap time for each circuit, plus track notes on its downforce level, layout, braking zones, overtaking and tire wear). "
    "Build your answer from three sources:\n"
    "1. The car data. Check every car listed before naming a highest/lowest/best, and quote the relevant "
    "numbers with their units (a HIGHER power-to-weight ratio is better, a lower weight is lighter). Each car's Notes are provided data too: use them for its layout, handling "
    "character, desirable and undesirable traits, driver suitability and the kinds of tracks it suits, and "
    "match those traits to the demands of the track in question.\n"
    "2. The track data. Quote the relevant numbers, and use the derived figures (miles or km, corners per mile or km) to "
    "characterize each circuit, e.g. high average speed and few corners per mile = a power/top-speed track; "
    "many corners per mile and a low average speed = a technical, agility/braking track. "
    "Each track's notes are provided data too: use them for its downforce level, layout, key corners and "
    "braking zones, overtaking chances and tire/brake wear, and set them against each car's Notes to judge "
    "how well a car's traits suit what the track demands.\n"
    "3. Your own general knowledge of racing in each car's discipline and of these circuits (layout, notable corners and straights, "
    "elevation, tire wear, car characteristics such as engine layout, aero and braking). The track ID identifies "
    "which circuit/layout a row refers to.\n"
    "Combine them: for example, match cars to tracks by comparing car power, weight and dimensions with the "
    "track's demands. Clearly separate what comes from the provided data from what comes from your general "
    "knowledge (for instance, by labeling the latter 'General knowledge:'), and label any estimate or "
    "judgement as such. Never invent numbers that are not in the data and present them as data; if the data "
    "doesn't contain something you need, say so and, if you can, offer your best-informed general-knowledge view. "
    "Compare every row internally, but keep the answer focused: only quote the cars and tracks that matter to the "
    "question (usually the top few), not every row, and end with a short conclusion. "
    "If a question has nothing to do with racecars or tracks, say you can only help with racing questions."
)


def build_messages(query, collection, top_k=None):
    """The chat messages for a question, and the documents they were built from."""
    print(f"\nProcessing query: {query}")

    # The car and track data sets are small, and questions like "which car is
    # the lightest?" or "which car suits Monza?" need every row to compare, so
    # retrieve them all (ordered by relevance to the question) unless a
    # smaller top_k is requested.
    if top_k is None:
        top_k = collection.count()

    related_chunks = find_related_chunks(query, collection, top_k) if top_k > 0 else []
    augmented_prompt = augment_prompt(query, related_chunks)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": augmented_prompt},
    ]
    references = [chunk[0] for chunk in related_chunks]
    return messages, references


def rag_pipeline(query, collection, llm_model, top_k=None):
    messages, references = build_messages(query, collection, top_k)
    response = llm_model.generate_completion(messages)

    print("\nGenerated response:")
    print(response)

    return response, references


def run_query(payload: dict) -> dict:
    """Handle a single question for the web UI (one process per call, so the
    car, track and ChromaDB setup is redone each time rather than kept in memory)."""
    query = payload.get("query", "")
    llm_type = payload.get("llmType", "openai")
    embedding_type = payload.get("embeddingType", "openai")
    # The user's Preferred Units: "standard" or "metric"
    units = payload.get("units", "standard")
    # promptOnly: answer the system prompt and the question's prompt instead of
    # an answer. The website sends them to the model picked for Racecar Analysis
    # in the Admin page's AI Model Control, which records its token counts.
    prompt_only = bool(payload.get("promptOnly", False))

    # load_documents/setup_chromadb/rag_pipeline print a lot of
    # human-readable progress info for the interactive CLI mode below;
    # swallow it here so stdout carries nothing but the JSON result.
    with contextlib.redirect_stdout(io.StringIO()):
        embedding_model = EmbeddingModel(embedding_type)

        documents, metadatas = load_documents(payload.get("cars", []), payload.get("tracks", []), units)
        collection = setup_chromadb(documents, metadatas, embedding_model)

        if prompt_only:
            messages, references = build_messages(query, collection)
            return {
                "system": messages[0]["content"],
                "prompt": messages[1]["content"],
                "references": references,
            }

        response, references = rag_pipeline(query, collection, LLMModel(llm_type))

    return {"response": response, "references": references}


def main():
    print("Starting the RAG pipeline demo...")

    # Select models
    llm_type, embedding_type = select_models()

    # Initialize models
    llm_model = LLMModel(llm_type)
    embedding_model = EmbeddingModel(embedding_type)

    print(f"\nUsing LLM: {llm_type.upper()}")
    print(f"Using Embeddings: {embedding_type.upper()}")

    # The car and track data are in the website's database (Car Data and Track Data), which the website sends with
    # each question; this terminal demo has neither, so it answers from general knowledge only.
    documents, metadatas = load_documents([], [])

    # Setup ChromaDB
    collection = setup_chromadb(documents, metadatas, embedding_model)

    # Run queries
    queries = [
        "Which car has the most power?",
        "Which GT3 car would be best suited to Monza, and why?",
    ]

    for query in queries:
        print("\n" + "=" * 50)
        print(f"Processing query: {query}")
        response, references = rag_pipeline(query, collection, llm_model)

        print("\nFinal Results:")
        print("-" * 30)
        print("Response:", response)
        print("\nReferences used:")
        for ref in references:
            print(f"- {ref}")
        print("=" * 50)


if __name__ == "__main__":
    # --stdin means the web UI is driving this (one question in, one answer
    # out), with a JSON payload on stdin; otherwise fall back to the original
    # interactive terminal demo.
    if len(sys.argv) > 1:
        try:
            result = run_query(json.loads(sys.stdin.read() if sys.argv[1] == "--stdin" else sys.argv[1]))
            print(json.dumps(result))
        except Exception as e:
            print(json.dumps({"error": str(e)}), file=sys.stderr)
            sys.exit(1)
    else:
        main()