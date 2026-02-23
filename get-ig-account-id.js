import "dotenv/config";
import axios from "axios";

const { FB_ACCESS_TOKEN } = process.env;

async function debugToken() {
  try {
    console.log("🔍 DIAGNOSTIC CHECK");
    const debug = await axios.get("https://graph.facebook.com/v19.0/debug_token",{
      params:{input_token:FB_ACCESS_TOKEN,access_token:FB_ACCESS_TOKEN}
    });
    console.log("Valid:", debug.data.data.is_valid);
    console.log("Scopes:", debug.data.data.scopes);

    const pages = await axios.get("https://graph.facebook.com/v19.0/me/accounts",{params:{access_token:FB_ACCESS_TOKEN}});
    for(const page of pages.data.data){
      console.log("Page:", page.name);
      const ig = await axios.get(`https://graph.facebook.com/v19.0/${page.id}`,{
        params:{fields:"instagram_business_account",access_token:page.access_token}
      });
      if(ig.data.instagram_business_account){
        console.log("✅ IG_ACCOUNT_ID:", ig.data.instagram_business_account.id);
      } else console.log("⚠️ No IG linked");
    }
  } catch(e){console.log(e.response?.data||e.message);}
}

debugToken();