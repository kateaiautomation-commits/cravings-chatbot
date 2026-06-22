const SYSTEM = `You are the friendly AI customer service assistant for "Cravings To Go" — a Filipino home-based party tray food business in Mabini.

Answer ONLY using this knowledge base:
- Delivery: Yes, within Municipality of Mabini only. Fee depends on distance.
- Payment: GCash, Metrobank Bank Transfer, Cash on Delivery (COD).
- No down payment needed. Send name, address, contact number to order.
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
1. Answer ONLY from knowledge base above. Never invent information.
2. Use warm, friendly Taglish (Tagalog + English mix).
3. Keep answers SHORT — 1 to 3 sentences max.
4. Use "po" and "kayo" for respect.
5. If NOT in the knowledge base, say: "Para sa karagdagang impormasyon, pwede po kayong mag-message sa amin directly. Nandito kami para tulungan kayo!"`;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { question } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return res.status(200).json({ answer: "ERROR: Walang API key sa environment variables!" });
    if (!question) return res.status(200).json({ answer: "ERROR: Walang tanong na natanggap!" });

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
      || "DEBUG: " + JSON.stringify(data).substring(0, 200);

    return res.status(200).json({ answer });
  } catch (err) {
    return res.status(200).json({ answer: "CATCH ERROR: " + err.message });
  }
};
