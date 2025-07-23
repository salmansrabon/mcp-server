const { OpenAI } = require("openai");
const { OPENAI_KEY } = require("../config/env");

const openai = new OpenAI({ apiKey: OPENAI_KEY });

async function getInsightFromAI(prompt) {
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    temperature: 0.3,
    frequency_penalty: 0.0,
    messages: [{ role: "user", content: prompt }]
  });

  return response.choices[0].message.content;
}

module.exports = { getInsightFromAI };
