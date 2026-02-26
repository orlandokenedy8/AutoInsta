// index.js
import "dotenv/config";
import express from "express";
import axios from "axios";
import cors from "cors";

const {
  IG_ACCOUNT_ID,
  FB_ACCESS_TOKEN,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_UPLOAD_PRESET,
} = process.env;

if (
  !IG_ACCOUNT_ID ||
  !FB_ACCESS_TOKEN ||
  !CLOUDINARY_CLOUD_NAME ||
  !CLOUDINARY_UPLOAD_PRESET
) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

const HASHTAGS = [
  "#motivation",
  "#success",
  "#mindset",
  "#discipline",
  "#quotes",
  "#dailyquotes",
  "#inspiration",
  "#growth",
  "#selfimprovement",
  "#positivity",
];
const getHashtags = () =>
  HASHTAGS.sort(() => 0.5 - Math.random())
    .slice(0, 5)
    .join(" ");

// --------------------
// Utility functions
// --------------------
function extractQuoteText(aiResponse) {
  if (typeof aiResponse === "string") return aiResponse;

  const candidates = ["content", "text", "message", "quote"];
  for (const key of candidates) {
    if (aiResponse[key] && typeof aiResponse[key] === "string") {
      return aiResponse[key];
    }
  }

  if (Array.isArray(aiResponse.choices) && aiResponse.choices.length > 0) {
    const choice = aiResponse.choices[0];
    if (choice.message && typeof choice.message.content === "string") {
      return choice.message.content;
    }
  }

  if (aiResponse.message && typeof aiResponse.message.content === "string") {
    return aiResponse.message.content;
  }

  let text = JSON.stringify(aiResponse);
  text = text.replace(
    /"?(index|message|refusal|annotations|finish_reason|usage|via_ai_chat_service)"?:.*?(,|})/g,
    ""
  );
  text = text.replace(/[{}"]/g, "").trim();

  return text || "Motivational quote";
}

function sanitizeCaptionText(text) {
  if (typeof text !== "string") return "";
  return text
    .trim()
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’]+$/, "")
    .replace(/^:+/, "")
    .replace(/:+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function uploadToCloudinary(base64) {
  try {
    const form = new URLSearchParams();
    form.append("file", `data:image/png;base64,${base64}`);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const res = await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      form,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (!res.data?.secure_url) throw new Error("No URL from Cloudinary");
    return res.data.secure_url;
  } catch (err) {
    log(
      `❌ Cloudinary upload failed: ${
        err.response?.data?.error?.message || err.message
      }`
    );
    throw err;
  }
}

// async function postToInstagram(caption, imageUrl) {
//   try {
//     const mediaRes = await axios.post(
//       `https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media`,
//       new URLSearchParams({
//         image_url: imageUrl,
//         caption,
//         access_token: FB_ACCESS_TOKEN,
//       }),
//       { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
//     );

//     const mediaId = mediaRes.data.id;
//     if (!mediaId) throw new Error("No media ID returned");

//     log(`✅ Media created: ${mediaId}`);

//     const publishRes = await axios.post(
//       `https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media_publish`,
//       new URLSearchParams({
//         creation_id: mediaId,
//         access_token: FB_ACCESS_TOKEN,
//       }),
//       { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
//     );

//     log("✅ Media published successfully");
//     return publishRes.data;
//   } catch (err) {
//     log(
//       `❌ Instagram API error: ${JSON.stringify(
//         err.response?.data || err.message,
//         null,
//         2
//       )}`
//     );
//     throw err;
//   }
// }

async function postToInstagram(caption, imageUrl) {
  try {
    const mediaRes = await axios.post(
      `https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media`,
      new URLSearchParams({
        image_url: imageUrl,
        caption,
        access_token: FB_ACCESS_TOKEN,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const mediaId = mediaRes.data.id;
    if (!mediaId) throw new Error("No media ID returned");

    log(`✅ Media created: ${mediaId}`);

    // -----------------------------
    // ✅ WAIT UNTIL MEDIA IS READY
    // -----------------------------
    let status = "IN_PROGRESS";
    const maxAttempts = 10;
    const delay = 3000; // 3 seconds

    for (let i = 0; i < maxAttempts; i++) {
      const statusRes = await axios.get(
        `https://graph.facebook.com/v19.0/${mediaId}`,
        {
          params: {
            fields: "status_code",
            access_token: FB_ACCESS_TOKEN,
          },
        }
      );

      status = statusRes.data.status_code;
      log(`⏳ Media status: ${status}`);

      if (status === "FINISHED") break;
      if (status === "ERROR")
        throw new Error("Instagram media processing failed");

      await new Promise((r) => setTimeout(r, delay));
    }

    if (status !== "FINISHED") {
      throw new Error("Timeout waiting for Instagram media processing");
    }

    // -----------------------------
    // 🚀 NOW PUBLISH
    // -----------------------------
    const publishRes = await axios.post(
      `https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media_publish`,
      new URLSearchParams({
        creation_id: mediaId,
        access_token: FB_ACCESS_TOKEN,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    log("✅ Media published successfully");
    return publishRes.data;
  } catch (err) {
    log(
      `❌ Instagram API error: ${JSON.stringify(
        err.response?.data || err.message,
        null,
        2
      )}`
    );
    throw err;
  }
}

async function sendTelegram(text, imageUrl = null) {
  try {
    if (imageUrl) {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          photo: imageUrl,
          caption: text,
          parse_mode: "HTML",
        }
      );
    } else {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: "HTML",
        }
      );
    }
  } catch (err) {
    log(`⚠️ Telegram failed: ${err.message}`);
  }
}

// --------------------
// Standalone Bot Function
// --------------------
async function runBot() {
  try {
    log("🚀 Running standalone bot...");

    // const themes = ["discipline and freedom", "consistency and progress", "growth mindset", "daily motivation"];
    const themes = [
                    success, failure, growth, mindset, 
                    discipline, consistency, self-belief, confidence, 
                    courage, resilience, perseverance, leadership, wisdom, 
                    happiness, gratitude, purpose, passion, ambition, productivity, 
                    simplicity, balance, change, transformation, healing, peace, strength, 
                    patience, self-love, relationships, friendship, love, family, time, 
                    freedom, dreams, goals, risk-taking, learning, character, integrity
                  ];
    const theme = themes[Math.floor(Math.random() * themes.length)];
    log(`🎯 Selected theme: ${theme}`);

    // Generate quote
    const rawQuote = await puter.ai.chat(
      "You are executing Phase 1 and Phase 2. Select one short, meaningful, properly attributed motivational quote about " +
        theme +
        " that is philosophically substantial, universally resonant, contextually accurate, and not an overused cliché. The quote must have a real confirmed author, be maximum 12 words, and contain no quotation marks. Internally analyze its emotional tone, psychological energy, symbolic meaning, emotional magnitude, and intimacy scale, but do not output this analysis. Output strictly in this format: Quote — Author.",
      { model: "gpt-5-nano" }
    );

    const quote = sanitizeCaptionText(extractQuoteText(rawQuote));
    log(`💬 Generated quote: ${quote}`);

    // Generate image
    const imageElement = await puter.ai.txt2img(
      "Using this quote as the emotional and symbolic anchor: " +
        quote +
        ". Create a true 4K 3840x3840 Instagram image with cinematic lighting, natural depth, DSLR realism, narrative authenticity, and professional editorial quality.",
      { model: "gpt-image-1.5", size: "3840x3840" }
    );

    // Convert to base64 (Node compatible)
    const canvas = globalThis.document
      ? document.createElement("canvas")
      : { getContext: () => ({ drawImage: () => {} }), width: 3840, height: 3840 };
    canvas.width = imageElement.width;
    canvas.height = imageElement.height;
    canvas.getContext("2d").drawImage(imageElement, 0, 0);
    const base64 = canvas.toDataURL?.("image/png")?.replace("data:image/png;base64,", "") || "";

    // Upload to Cloudinary
    const imageUrl = await uploadToCloudinary(base64);
    log(`🖼️ Uploaded image URL: ${imageUrl}`);

    // Post to Instagram
    const caption = `${quote}\n\n${getHashtags()}`;
    await postToInstagram(caption, imageUrl);

    // Send Telegram notification
    const telegramText = `✅ <b>Instagram Post Published</b>\n\n${quote}\n\n${getHashtags()}`;
    await sendTelegram(telegramText, imageUrl);

    log("✅ Standalone bot run completed successfully!");
  } catch (err) {
    log(`❌ Standalone bot failed: ${err.message}`);
    await sendTelegram(`❌ <b>Instagram Post Failed</b>\n${err.message}`);
  }
}

// Run bot if called with --run-bot
if (process.argv.includes("--run-bot")) {
  runBot()
    .then(() => {
      log("✅ Done");
      process.exit(0);
    })
    .catch((err) => {
      log("❌ Failed:", err);
      process.exit(1);
    });
}

// --------------------
// Existing Express Server Routes
// --------------------
app.post("/receive-ai", async (req, res) => {
  try {
    const { quote, base64 } = req.body;
    if (!quote || !base64) throw new Error("Missing quote or image");

    log("📥 Received AI content");

    const rawQuote = extractQuoteText(quote);
    const cleanQuote = sanitizeCaptionText(rawQuote);

    const caption = `${cleanQuote}\n\n${getHashtags()}`.trim();

    const imageUrl = await uploadToCloudinary(base64);

    await postToInstagram(caption, imageUrl);

    const telegramText = `✅ <b>Instagram Post Published</b>\n\n${cleanQuote}\n\n${getHashtags()}`;
    await sendTelegram(telegramText, imageUrl);

    res.json({ success: true });
  } catch (err) {
    log(`❌ Post failed: ${err.message}`);
    await sendTelegram(`❌ <b>Instagram Post Failed</b>\n${err.message}`);
    // res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<body>
<script src="https://js.puter.com/v2/"></script>
<script>
// const themes=["discipline and freedom","consistency and progress","growth mindset","daily motivation"];
const themes = [
  "success", "failure", "growth", "mindset",
  "discipline", "consistency", "self-belief", "confidence",
  "courage", "resilience", "perseverance", "leadership", "wisdom",
  "happiness", "gratitude", "purpose", "passion", "ambition", "productivity",
  "simplicity", "balance", "change", "transformation", "healing", "peace", "strength",
  "patience", "self-love", "relationships", "friendship", "love", "family", "time",
  "freedom", "dreams", "goals", "risk-taking", "learning", "character", "integrity"
];
// async function run() {
//   // try {
//     const theme = themes[Math.floor(Math.random()*themes.length)];
//     const quote = await puter.ai.chat(
//     // "You are executing Phase 1 and Phase 2. Select one short, meaningful, properly attributed motivational quote about " + theme + " that is philosophically substantial, universally resonant, contextually accurate, and not an overused cliché. The quote must have a real confirmed author, be maximum 12 words, and contain no quotation marks. Internally analyze its emotional tone, psychological energy, symbolic meaning, emotional magnitude, and intimacy scale, but do not output this analysis. Output strictly in this format: Quote — Author.",
//     // { model: "gpt-5-nano" }
//     //  );
//     "Select a completely new, meaningful quote from a different author than previously used. Do not reuse any prior quote, author " + theme + " from earlier outputs. Ensure the quote is philosophically substantial, properly attributed, and not overused. The quote must have a real confirmed author, be maximum 12 words, and contain no quotation marks. Output strictly in this format: Quote — Author.",
//     { model: "gpt-5-nano" }
//      );

//     const imageElement = await puter.ai.txt2img(
//     // "Using this quote as the emotional and symbolic anchor: " + quote + ". Create a true 4K 3840x3840 square Instagram image that feels commissioned, professionally shot in RAW, expertly color graded, luxury editorial quality, and indistinguishable from real photography. Design a physically plausible real-world scene with narrative authenticity, natural complexity balance, and clear foreground, midground, and dimensional background depth. Avoid staged symbolism, summit silhouettes, exaggerated metaphor stacking, visual clichés, overcrowding, or oversimplification. Render as captured on a high-end full-frame DSLR or cinema camera with authentic focal length selection, gradual depth of field falloff, slight lens edge softness, smooth highlight rolloff, realistic exposure balance, subtle sensor grain, natural shadow depth variation, accurate reflections, and physically plausible scale relationships. Use dark cinematic lighting aligned emotionally with the quote, maintain directional light consistency, realistic color temperature, professional contrast curves, natural tonal transitions, and avoid hyper-saturation or artificial HDR effects. Apply asymmetrical composition with intentional eye movement, clear focal hierarchy, balanced negative space for typography, and natural perspective geometry. Overlay the quote and author in refined editorial typography that is perfectly crisp at 4K with accurate kerning, harmonious with lighting direction, respecting scene depth, maintaining print-safe margins, and placing the author subtly beneath the quote with elegant visual weight balance.",
//     // { model: "gemini-3-pro-image-preview", size: "3840x3840" }
//     // );
//     "Using this quote as the emotional and symbolic anchor: " + quote + ". Produce a stunning, award-winning a 4K 3840x4800 minimalist editorial Instagram quote image. The background must be visually distinct and unpredictable. Avoid repeating previously used environmental themes or symbolic elements. Maintain minimalist composition with strong negative space for text overlay. Use only one primary focal element. Symbolism must be subtle and indirect. Lighting natural but varied. Composition must differ in perspective, spatial depth, and tonal range from prior outputs. Prioritize novelty over familiarity while preserving calm editorial refinement. Use Imagen 3 model to create this image. Overlay the quote and author in refined editorial typography that is perfectly crisp at 4K with accurate kerning, harmonious with lighting direction, respecting scene depth, maintaining print-safe margins, and placing the author subtly beneath the quote with elegant visual weight balance.",
//     { model: "gemini-3-pro-image-preview", size: "3840x3840" }
//     );

//     const canvas=document.createElement("canvas");
//     canvas.width=imageElement.width; canvas.height=imageElement.height;
//     canvas.getContext("2d").drawImage(imageElement,0,0);
//     const base64=canvas.toDataURL("image/png").replace("data:image/png;base64,","");
//     await fetch("/receive-ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({quote,base64})});
//     document.body.innerHTML="<h2>Posted Successfully ✅</h2>";
//   // } 
//     // catch(e){document.body.innerHTML="<h2>Error: "+e.message+"</h2>";}
// }
// run();
async function run() {

  const theme = themes[Math.floor(Math.random() * themes.length)];

  // -------------------------
  // LOAD PREVIOUSLY USED QUOTES
  // -------------------------
  const storedQuotes = JSON.parse(localStorage.getItem("usedQuotes") || "[]");
  let quote = null;
  let attempts = 0;
  const maxAttempts = 5;

  // -------------------------
  // PHASE 1: UNIQUE QUOTE GENERATION
  // -------------------------
  while (attempts < maxAttempts) {

    const generated = await puter.ai.chat(
      "Select a completely new, meaningful quote from a different author than previously used. Do not reuse any prior quote, author, or theme from earlier outputs. Ensure the quote is philosophically substantial, properly attributed, and not overused. The quote must have a real confirmed author, be maximum 12 words, and contain no quotation marks. Output strictly in this format: Quote — Author.",
      { model: "gpt-5-nano" }
    );

    if (!storedQuotes.includes(generated)) {
      quote = generated;
      storedQuotes.push(generated);
      localStorage.setItem("usedQuotes", JSON.stringify(storedQuotes));
      break;
    }

    attempts++;
  }

  if (!quote) {
    document.body.innerHTML = "<h2>Error: Could not generate unique quote.</h2>";
    return;
  }

  // -------------------------
  // PHASE 2: IMAGE GENERATION
  // -------------------------
  const imageElement = await puter.ai.txt2img(
    "Using this quote as the emotional and symbolic anchor: " + quote +
    ". Create a true 4K 3840x4800 minimalist editorial Instagram quote image. " +
    "The background must be visually distinct and unpredictable. Avoid repeating previously used environmental themes or symbolic elements. " +
    "Maintain minimalist composition with strong negative space for text overlay. Use only one primary focal element. " +
    "Symbolism must be subtle and indirect. Lighting natural but varied. " +
    "Composition must differ in perspective, spatial depth, and tonal range from prior outputs. " +
    "Prioritize novelty over familiarity while preserving calm editorial refinement. " +
    "Render as professional high-end photography with natural color science, realistic exposure, authentic lens rendering, soft highlight rolloff, and subtle depth falloff. " +
    "Overlay the quote and author in refined editorial typography perfectly crisp at 4K resolution, with precise kerning, elegant hierarchy, balanced margins, harmonious alignment with lighting direction, and the author placed subtly beneath the quote.",
    { model: "gemini-3-pro-image-preview", size: "3840x4800" }
  );

  // -------------------------
  // CANVAS EXPORT
  // -------------------------
  const canvas = document.createElement("canvas");
  canvas.width = imageElement.width;
  canvas.height = imageElement.height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(imageElement, 0, 0);

  const base64 = canvas
    .toDataURL("image/png")
    .replace("data:image/png;base64,", "");

  await fetch("/receive-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quote, base64 })
  });

  document.body.innerHTML = "<h2>Posted Successfully ✅</h2>";
}

run();
</script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  log(`🌐 Server running at http://localhost:${PORT}`);
}); 
