const SYSTEM = `You are the friendly AI customer service assistant for "Cravings To Go" — a Filipino home-based party tray food business in Mabini.
 
Answer ONLY using this knowledge base:
 
- Delivery: Yes, within Municipality of Mabini only. Fee depends on distance.
- Payment: GCash, Metrobank Bank Transfer, Cash on Delivery (COD).
- No down payment needed. Send name, address, contact number.
- Small tray: up to 10 pax. Big tray: up to 20 pax.
- Chicken Wings: Small=26pcs, Big=54pcs.
- Cordon Bleu: Small=40pcs, Big=85pcs.
- Shanghai: Small=60pcs, Big=135pcs.
- Order: Send order details, delivery date, address, contact number.
- No minimum order. At least 2 days advance order required.
- No cancellation once confirmed. No refund once confirmed.
- Business hours: Monday-Friday, lunch time until supplies last.
- Closed Saturday and Sunday.
- Bulk orders: message for special pricing.
 
RULES:
1. Answer ONLY from knowledge base above.
2. Use warm, friendly Taglish.
3. Keep answers SHORT — 1 to 3 sentences.
4. Use "po" and "kayo".
5. If not in knowledge base: "Para sa karagdagang impormasyon, mag-message po kayo sa amin directly!"`;
 
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
 
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
 
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(200).json({ answer: "ERROR: Walang API key sa environment!" });
 
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ answer: "Walang tanong na natanggap." });
 
    const prompt = `${SYSTEM}\n\nCustomer question: ${question}\n\nYour answer:`;
 
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.3 },
        }),
      }
    );
 
    const data = await response.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text
      || "DEBUG: " + JSON.stringify(data);
 
    return res.status(200).json({ answer });
  } catch (err) {
    return res.status(500).json({ answer: "Error: " + err.message });
  }
};
