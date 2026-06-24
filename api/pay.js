import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, query, orderByChild, equalTo, update } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyA5J6kGSOVlo01EMSZpbrpAfX0E_mtw75Y",
  authDomain: "swift-pay-wallet.firebaseapp.com",
  databaseURL: "https://swift-pay-wallet-default-rtdb.firebaseio.com",
  projectId: "swift-pay-wallet",
  storageBucket: "swift-pay-wallet.firebasestorage.app",
  messagingSenderId: "75236316198",
  appId: "1:75236316198:web:2013630dec331a9d2742e7"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const TELEGRAM_BOT_TOKEN = "8829055664:AAEK2CjRFYxLUAGMm3CPpgjd8z-ND2dw3V4";

async function sendTgAlert(tgId, message) {
    if (!tgId) return;
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: tgId, text: message })
        });
    } catch (e) {
        console.error("Telegram Alert Failed", e);
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { key, paytm, amount, comment } = req.query;

        if (!key || !paytm || !amount) {
            return res.status(400).json({ status: "error", message: "Missing parameters! Need key, paytm, and amount." });
        }

        const withdrawAmount = Number(amount);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
            return res.status(400).json({ status: "error", message: "Invalid amount!" });
        }

        if (!key.startsWith("TP-")) {
            return res.status(401).json({ status: "error", message: "Invalid API Key format!" });
        }

        const usersRef = ref(db, "users");
        const qAdmin = query(usersRef, orderByChild("apiKey"), equalTo(key));
        const adminSnap = await get(qAdmin);

        if (!adminSnap.exists()) {
            return res.status(401).json({ status: "error", message: "Invalid or Expired API Key!" });
        }

        let adminPhone = null;
        let adminData = null;
        
        adminSnap.forEach((child) => {
            adminPhone = child.key;
            adminData = child.val();
        });

        const currentAdminBal = Number(adminData.balance) || 0;
        if (currentAdminBal < withdrawAmount) {
            return res.status(400).json({ status: "error", message: "API Owner has insufficient balance!" });
        }

        let receiverPhone = paytm.trim();
        if (receiverPhone.length === 10) {
            receiverPhone = "+91" + receiverPhone; 
        } else if (!receiverPhone.startsWith("+91") && receiverPhone.length === 12) {
             receiverPhone = "+" + receiverPhone;
        }

        const receiverRef = ref(db, "users/" + receiverPhone);
        const receiverSnap = await get(receiverRef);

        if (!receiverSnap.exists()) {
            return res.status(404).json({ status: "error", message: `User ${paytm} is not registered in Swift Pay Wallet!` });
        }

        const currentReceiverBal = Number(receiverSnap.val().balance) || 0;
        const updates = {};
        
        updates[`users/${adminPhone}/balance`] = currentAdminBal - withdrawAmount;
        updates[`users/${receiverPhone}/balance`] = currentReceiverBal + withdrawAmount;

        const exactDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const txnId1 = "API_OUT" + Date.now();
        const txnId2 = "API_IN" + Date.now();

        updates[`transactions/${txnId1}`] = {
            id: txnId1, userPhone: adminPhone, receiver: receiverPhone, amount: withdrawAmount,
            type: "API SEND", status: "SUCCESS", date: exactDate, timestamp: Date.now(), comment: comment || "Bot Payout"
        };
        updates[`users/${adminPhone}/transactions/${txnId1}`] = {
            id: txnId1, type: "TXN", title: "API Payment Sent", amount: withdrawAmount,
            status: "SUCCESS", timestamp: Date.now(), date: exactDate, isCredit: false, sign: "-", info: "To: " + receiverPhone
        };
        updates[`transactions/${txnId2}`] = {
            id: txnId2, userPhone: receiverPhone, sender: "API System", amount: withdrawAmount,
            type: "API RECEIVED", status: "SUCCESS", date: exactDate, timestamp: Date.now(), comment: comment || "Received from Bot"
        };
        updates[`users/${receiverPhone}/transactions/${txnId2}`] = {
            id: txnId2, type: "TXN", title: "API Payment Received", amount: withdrawAmount,
            status: "SUCCESS", timestamp: Date.now(), date: exactDate, isCredit: true, sign: "+", info: "From API"
        };

        await update(ref(db), updates);

        if (adminData.tgId) {
            const apiAlertMsg = `🚨 API DEBIT ALERT\n\nSent To: ${receiverPhone}\nAmount Deducted: ₹${withdrawAmount}\nNew Balance: ₹${(currentAdminBal - withdrawAmount).toFixed(2)}\nTxn ID: ${txnId1}\n(Via API Key Request)`;
            await sendTgAlert(adminData.tgId, apiAlertMsg);
        }

        return res.status(200).json({
            status: "success",
            message: "Payment successful",
            data: { transaction_id: txnId2, amount: withdrawAmount, receiver: receiverPhone, timestamp: exactDate }
        });

    } catch (error) {
        return res.status(500).json({ status: "error", message: "Internal Server Error", details: error.message });
    }
}
