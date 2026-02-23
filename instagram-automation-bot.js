import "dotenv/config";
import express from "express";
import axios from "axios";
import cors from "cors";

const { IG_ACCOUNT_ID, FB_ACCESS_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } = process.env;

if (!IG_ACCOUNT_ID || !FB_ACCESS_TOKEN || !CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
  console.error("❌ Missing environment variables!");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// --- Utilities ---
const HASHTAGS = ["#motivation","#success","#mindset","#discipline","#quotes","#dailyquotes","#inspiration","#growth","#selfimprovement","#positivity"];
const getHashtags = () => HASHTAGS.sort(()=>0.5-Math.random()).slice(0,5).join(" ");

function sanitizeCaptionText(text) {
  return typeof text === "string" ? text.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g,"").replace(/^:+|:+$/g,"").replace(/\s+/g," ").trim() : "";
}

async function uploadToCloudinary(base64){
  const form = new URLSearchParams();
  form.append("file", `data:image/png;base64,${base64}`);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await axios.post(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, form, { headers: { "Content-Type": "application/x-www-form-urlencoded" }});
  if(!res.data?.secure_url) throw new Error("No URL from Cloudinary");
  return res.data.secure_url;
}

async function postToInstagram(caption, imageUrl){
  const mediaRes = await axios.post(`https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media`, new URLSearchParams({image_url: imageUrl, caption, access_token: FB_ACCESS_TOKEN}), { headers: { "Content-Type": "application/x-www-form-urlencoded" }});
  const mediaId = mediaRes.data.id;
  if(!mediaId) throw new Error("No media ID returned");
  return await axios.post(`https://graph.facebook.com/v19.0/${IG_ACCOUNT_ID}/media_publish`, new URLSearchParams({creation_id: mediaId, access_token: FB_ACCESS_TOKEN}), { headers: { "Content-Type": "application/x-www-form-urlencoded" }});
}

async function sendTelegram(text, imageUrl=null){
  try {
    if(imageUrl){
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, { chat_id: TELEGRAM_CHAT_ID, photo:imageUrl, caption:text, parse_mode:"HTML"});
    } else {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text, parse_mode:"HTML"});
    }
  } catch(e){
    log("⚠️ Telegram failed: "+e.message);
  }
}

// --- Endpoint ---
app.post("/receive-ai", async (req,res)=>{
  try {
    const { quote, base64 } = req.body;
    if(!quote || !base64) throw new Error("Missing quote or image");

    const caption = `${sanitizeCaptionText(quote)}\n\n${getHashtags()}`;
    const imageUrl = await uploadToCloudinary(base64);
    await postToInstagram(caption,imageUrl);
    await sendTelegram(`✅ Instagram post published!\n\n${caption}`, imageUrl);
    res.json({ success:true });
  } catch(e){
    await sendTelegram(`❌ Instagram post failed!\n${e.message}`);
    res.status(500).json({ error:e.message });
  }
});

const PORT=3000;
app.listen(PORT,()=>log(`🌐 Server running at http://localhost:${PORT}`));
