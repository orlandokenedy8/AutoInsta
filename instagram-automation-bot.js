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

// Utility to safely extract quote text from AI response object
function extractQuoteText(aiResponse) {
  if (typeof aiResponse === "string") {
    return aiResponse;
  }

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
    "",
  );
  text = text.replace(/[{}"]/g, "").trim();

  return text || "Motivational quote";
}

// Sanitize the extracted quote text by removing extra quotes, colons, and trimming
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

// Upload Base64 image to Cloudinary
async function uploadToCloudinary(base64) {
  try {
    const form = new URLSearchParams();
    form.append("file", `data:image/png;base64,${base64}`);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const res = await axios.post(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
      form,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    if (!res.data?.secure_url) throw new Error("No URL from Cloudinary");
    return res.data.secure_url;
  } catch (err) {
    log(
      `❌ Cloudinary upload failed: ${
        err.response?.data?.error?.message || err.message
      }`,
    );
    throw err;
  }
}

// Post to Instagram
async function postToInstagram(caption, imageUrl) {
  try {
    const mediaRes = await axios.post(
      `https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media`,
      new URLSearchParams({
        image_url: imageUrl,
        caption,
        access_token: FB_ACCESS_TOKEN,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const mediaId = mediaRes.data.id;
    if (!mediaId) throw new Error("No media ID returned");

    log(`✅ Media created: ${mediaId}`);

    const publishRes = await axios.post(
      `https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media_publish`,
      new URLSearchParams({
        creation_id: mediaId,
        access_token: FB_ACCESS_TOKEN,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    log("✅ Media published successfully");
    return publishRes.data;
  } catch (err) {
    log(
      `❌ Instagram API error: ${JSON.stringify(
        err.response?.data || err.message,
        null,
        2,
      )}`,
    );
    throw err;
  }
}

// Send Telegram message (with optional image URL for preview)
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
        },
      );
    } else {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: "HTML",
        },
      );
    }
  } catch (err) {
    log(`⚠️ Telegram failed: ${err.message}`);
  }
}

app.post("/receive-ai", async (req, res) => {
  try {
    const { quote, base64 } = req.body;
    if (!quote || !base64) throw new Error("Missing quote or image");

    log("📥 Received AI content");

    // Extract and sanitize quote
    const rawQuote = extractQuoteText(quote);
    const cleanQuote = sanitizeCaptionText(rawQuote);

    // Caption with hashtags
    const caption = `${cleanQuote}\n\n${getHashtags()}`;

    // Upload image to Cloudinary
    const imageUrl = await uploadToCloudinary(base64);

    // Post to Instagram
    await postToInstagram(caption, imageUrl);

    // Send Telegram notification with photo and caption
    const telegramText = `✅ <b>Instagram Post Published</b>\n\n${cleanQuote}\n\n${getHashtags()}`;
    await sendTelegram(telegramText, imageUrl);

    res.json({ success: true });
  } catch (err) {
    log(`❌ Post failed: ${err.message}`);
    await sendTelegram(`❌ <b>Instagram Post Failed</b>\n${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<body>
<script src="https://js.puter.com/v2/"></script>
<script>
const themes=["discipline and freedom","consistency and progress","growth mindset","daily motivation"];
async function run() {
  try {
    const theme = themes[Math.floor(Math.random()*themes.length)];
    const quote = await puter.ai.chat(
    "You are executing Phase 1 and Phase 2. Select one short, meaningful, properly attributed motivational quote about " + theme + " that is philosophically substantial, universally resonant, contextually accurate, and not an overused cliché. The quote must have a real confirmed author, be maximum 12 words, and contain no quotation marks. Internally analyze its emotional tone, psychological energy, symbolic meaning, emotional magnitude, and intimacy scale, but do not output this analysis. Output strictly in this format: Quote — Author.",
    { model: "gpt-5-nano" }
     );

    const imageElement = await puter.ai.txt2img(
    "Using this quote as the emotional and symbolic anchor: " + quote + ". Create a true 4K 3840x3840 square Instagram image that feels commissioned, professionally shot in RAW, expertly color graded, luxury editorial quality, and indistinguishable from real photography. Design a physically plausible real-world scene with narrative authenticity, natural complexity balance, and clear foreground, midground, and dimensional background depth. Avoid staged symbolism, summit silhouettes, exaggerated metaphor stacking, visual clichés, overcrowding, or oversimplification. Render as captured on a high-end full-frame DSLR or cinema camera with authentic focal length selection, gradual depth of field falloff, slight lens edge softness, smooth highlight rolloff, realistic exposure balance, subtle sensor grain, natural shadow depth variation, accurate reflections, and physically plausible scale relationships. Use dark cinematic lighting aligned emotionally with the quote, maintain directional light consistency, realistic color temperature, professional contrast curves, natural tonal transitions, and avoid hyper-saturation or artificial HDR effects. Apply asymmetrical composition with intentional eye movement, clear focal hierarchy, balanced negative space for typography, and natural perspective geometry. Overlay the quote and author in refined editorial typography that is perfectly crisp at 4K with accurate kerning, harmonious with lighting direction, respecting scene depth, maintaining print-safe margins, and placing the author subtly beneath the quote with elegant visual weight balance.",
    { model: "gpt-image-1.5", size: "3840x3840" }
    );

    const canvas=document.createElement("canvas");
    canvas.width=imageElement.width; canvas.height=imageElement.height;
    canvas.getContext("2d").drawImage(imageElement,0,0);
    const base64=canvas.toDataURL("image/png").replace("data:image/png;base64,","");
    await fetch("/receive-ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({quote,base64})});
    document.body.innerHTML="<h2>Posted Successfully ✅</h2>";
  } catch(e){document.body.innerHTML="<h2>Error: "+e.message+"</h2>";}
}
run();
</script>
</body>
</html>
  `);
});

const PORT = 3000;
app.listen(PORT, () => {
  log(`🌐 Server running at http://localhost:${PORT}`);
});
