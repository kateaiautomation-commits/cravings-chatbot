exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
  }

  const apiKey = process.env.GEMINI_API_KEY;

  // Debug: check if API key exists
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ answer: "DEBUG: Walang API key na nakita sa environment variables!" })
    };
  }

  try {
    const { question } = JSON.parse(event.body);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Say hello in Filipino in one sentence." }] }]
        }),
      }
    );

    const data = await response.json();
    const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text
      || "FULL RESPONSE: " + JSON.stringify(data);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ answer })
    };

  } catch (err) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ answer: "CATCH ERROR: " + err.message })
    };
  }
};
