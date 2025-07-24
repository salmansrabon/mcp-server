const express = require("express");
const router = express.Router();
const findRelevantCodeViaVector = require("../analyzers/findRelevantCodeViaVector");
const { OpenAI } = require("openai");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post("/explain/code", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid 'prompt' in request body" });
    }

    //Search relevant code chunks
    const result = await findRelevantCodeViaVector(prompt);

    if (!result || result.length === 0) {
      return res.status(404).json({ error: "No relevant code found" });
    }

    //Build GPT prompt
    const gptPrompt = `Below is a set of code snippets relevant to the user's query:\n\n${result}\n\nExplain what this code does and how it's related to the query: "${prompt}"`;

    // Step 3: Ask GPT to explain
    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          temparature: 0.5,
          content: "You are a helpful AI software engineer. Your job is to analyze and explain code and its context.",
        },
        {
          role: "user",
          content: gptPrompt,
        },
      ],
    });

    const explanation = gptResponse.choices[0].message.content;

    // Step 4: Respond with both code and GPT's explanation
    res.status(200).json({
      codeMatches: result,
      explanation,
    });
  } catch (err) {
    console.error("Error in /explain/code:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
