const { ChromaClient } = require("chromadb");

(async () => {
  const client = new ChromaClient({
    host: "localhost",
    port: process.env.CHROMA_DB_PORT || 8001,
    ssl: false,
  });

  try {
    await client.deleteCollection({ name: "codebase" });
    console.log("🗑️ Collection 'codebase' deleted successfully.");
  } catch (error) {
    console.error("❌ Error deleting collection:", error);
  }
})();
