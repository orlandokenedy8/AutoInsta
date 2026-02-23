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

if (!IG_ACCOUNT_ID || !FB_ACCESS_TOKEN || !CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
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
const getHashtags = () => HASHTAGS.sort(() => 0.5 - Math.random()).slice(0, 5).join(" ");

// Utility functions (sanitize, extract) remain the same
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
  const form = new URLSearchParams();
  form.append("file", `data:image/png;base64,${base64}`);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await axios.post(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    form,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return res.data.secure_url;
}

async function postToInstagram(caption, imageUrl) {
  const mediaRes = await axios.post(
    `https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media`,
    new URLSearchParams({ image_url: imageUrl, caption, access_token: FB_ACCESS_TOKEN }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const mediaId = mediaRes.data.id;
  await axios.post(
    `https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media_publish`,
    new URLSearchParams({ creation_id: mediaId, access_token: FB_ACCESS_TOKEN }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
}

async function sendTelegram(text, imageUrl = null) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  if (imageUrl) {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      chat_id: TELEGRAM_CHAT_ID,
      photo: imageUrl,
      caption: text,
      parse_mode: "HTML",
    });
  } else {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
    });
  }
}

// --------------------
// /receive-ai route
// --------------------
app.post("/receive-ai", async (req, res) => {
  try {
    const { quote, base64 } = req.body;
    if (!quote || !base64) throw new Error("Missing quote or image");
    const imageUrl = await uploadToCloudinary(base64);
    const caption = `${sanitizeCaptionText(quote)}\n\n${getHashtags()}`;
    await postToInstagram(caption, imageUrl);
    await sendTelegram(`✅ Instagram Post Published\n${quote}`, imageUrl);
    res.json({ success: true });
  } catch (err) {
    await sendTelegram(`❌ Instagram Post Failed\n${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// --------------------
// Serve frontend HTML
// --------------------
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<body>
<h2>Running Daily Instagram Bot...</h2>
<script src="https://js.puter.com/v2/"></script>
<script>
const themes=["discipline and freedom","consistency and progress","growth mindset","daily motivation"];
async function runBot() {
  try {
    const theme = themes[Math.floor(Math.random()*themes.length)];
    const quote = await puter.ai.chat("Select a short motivational quote about "+theme+" (max 12 words, real author, no quotes). Output as: Quote — Author.", { model:"gpt-5-nano" });
    const image = await puter.ai.txt2img("Use this quote as anchor: "+quote+". 4K 3840x3840 Instagram image, cinematic realistic lighting.", { model:"gpt-image-1.5", size:"3840x3840" });
    const canvas=document.createElement("canvas");
    canvas.width=image.width; canvas.height=image.height;
    canvas.getContext("2d").drawImage(image,0,0);
    const base64=canvas.toDataURL("image/png").replace("data:image/png;base64,","");
    await fetch("/receive-ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({quote,base64})});
    document.body.innerHTML="<h2>✅ Posted Successfully</h2>";
  } catch(e){document.body.innerHTML="<h2>❌ Error: "+e.message+"</h2>";}
}
runBot();
</script>
</body>
</html>
  `);
});

// --------------------
// Bind to Render port
// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log(`🌐 Server running at port ${PORT}`));
