import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, update, increment, query, orderByChild, equalTo } from "firebase/database";

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

const TELEGRAM_BOT_TOKEN = "8806396490:AAFiguvmE9Zsupf_uGCU-A8ROEFAQ2Drdh8";

const ADMIN_PHONE = "8581898204";
const ADMIN_PASSWORD = "Noor1234@";

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
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: "Only POST allowed" });

    const { action, data } = req.body;

    try {
        if (action === 'ADMIN_LOGIN') {
            if (data.phone !== ADMIN_PHONE || data.password !== ADMIN_PASSWORD) {
                throw new Error("Invalid Admin Credentials!");
            }
            return res.json({ data: { success: true, role: "admin" } });
        }

        if (action === 'GET_ADMIN_DATA') {
            if (data.phone !== ADMIN_PHONE || data.password !== ADMIN_PASSWORD) {
                throw new Error("Unauthorized!");
            }
            
            const [depSnap, withSnap, usersSnap] = await Promise.all([
                get(ref(db, "deposits")),
                get(ref(db, "withdrawals")),
                get(ref(db, "users"))
            ]);
            
            let deposits = [];
            let withdrawals = [];
            
            if (depSnap.exists()) {
                depSnap.forEach(c => { deposits.push(c.val()); });
            }
            if (withSnap.exists()) {
                withSnap.forEach(c => { withdrawals.push(c.val()); });
            }
            
            return res.json({ data: { deposits, withdrawals } });
        }

        if (action === 'UPDATE_DEPOSIT_STATUS') {
            if (data.adminPhone !== ADMIN_PHONE || data.adminPassword !== ADMIN_PASSWORD) {
                throw new Error("Unauthorized!");
            }
            
            const { txnId, status } = data;
            const updates = {
                [`deposits/${txnId}/status`]: status
            };
            
            if (status === 'APPROVED') {
                const depSnap = await get(ref(db, `deposits/${txnId}`));
                if (depSnap.exists()) {
                    const dep = depSnap.val();
                    updates[`users/${dep.userPhone}/balance`] = increment(Number(dep.amount) || 0);
                }
            }
            
            await update(ref(db), updates);
            return res.json({ data: "Deposit Status Updated" });
        }

        if (action === 'UPDATE_WITHDRAWAL_STATUS') {
            if (data.adminPhone !== ADMIN_PHONE || data.adminPassword !== ADMIN_PASSWORD) {
                throw new Error("Unauthorized!");
            }
            
            const { txnId, status } = data;
            await update(ref(db, `withdrawals/${txnId}`), { status });
            return res.json({ data: "Withdrawal Status Updated" });
        }

        if (action === 'LOGIN') {
            let phone = data.phone;
            // Normalize phone - remove +91 if present, keep only 10 digits
            phone = phone.replace(/\D/g, '').slice(-10);
            
            const uRef = ref(db, `users/${data.phone}`);
            const snap = await get(uRef);
            
            if (!snap.exists()) {
                // Try without +91
                const uRef2 = ref(db, `users/${phone}`);
                const snap2 = await get(uRef2);
                if (!snap2.exists()) throw new Error("User not found!");
                if (snap2.val().password !== data.password) throw new Error("Invalid Password!");
                if (snap2.val().banned) throw new Error("Account Banned by Admin.");
                return res.json({ data: snap2.val() });
            }
            
            if (snap.val().password !== data.password) throw new Error("Invalid Mobile or Password!");
            if (snap.val().banned) throw new Error("Account Banned by Admin.");
            return res.json({ data: snap.val() });
        }

        if (action === 'SEND_OTP') {
            return res.json({ data: "OTP Sent" });
        }

        if (action === 'REGISTER') {
            // Normalize phone - keep full format with +91
            const uRef = ref(db, `users/${data.phone}`);
            const snap = await get(uRef);
            if (snap.exists()) throw new Error("Number already registered!");

            const newUser = {
                name: data.name, 
                phone: data.phone, 
                password: data.password, 
                pin: data.pin, 
                tgId: data.tgId || "", 
                balance: 0, 
                banned: false, 
                joinedAt: new Date().toISOString()
            };
            
            await set(uRef, newUser);
            
            if(data.tgId) {
                await sendTgAlert(data.tgId, `🎉 Welcome to Swift Pay Wallet, ${data.name}!\nYour account has been created successfully.`);
            }
            
            return res.json({ data: newUser });
        }

        if (action === 'STATISTICS') {
            const hSnap = await get(ref(db, `users/${data.phone}/transactions`));
            let totalTxns = 0;
            let successTxns = 0;
            let totalCredit = 0;
            
            if (hSnap.exists()) {
                hSnap.forEach(c => {
                    const txn = c.val();
                    totalTxns++;
                    if (txn.status === 'SUCCESS') {
                        successTxns++;
                        if (txn.isCredit === true || txn.isCredit === "true") {
                            totalCredit += Number(txn.amount) || 0;
                        }
                    }
                });
            }
            
            let successRate = totalTxns > 0 ? ((successTxns / totalTxns) * 100).toFixed(1) : 0;
            return res.json({ data: { totalTxns, successTxns, successRate, totalCredit } });
        }

        if (action === 'SYNC') {
            const [uSnap, cSnap] = await Promise.all([ get(ref(db, `users/${data.phone}`)), get(ref(db, "settings/config")) ]);
            if (!uSnap.exists()) throw new Error("User not found");
            return res.json({ data: { user: uSnap.val(), config: cSnap.val() || {} } });
        }

        if (action === 'HISTORY') {
            const hSnap = await get(ref(db, `users/${data.phone}/transactions`));
            let txns = [];
            if (hSnap.exists()) hSnap.forEach(c => { txns.push(c.val()); });
            return res.json({ data: txns });
        }

        if (action === 'CHECK_RECEIVER') {
            const snap = await get(ref(db, `users/${data.phone}`));
            if (!snap.exists()) throw new Error("Not Registered");
            return res.json({ data: snap.val().name });
        }

        if (action === 'UPDATE_PROFILE') { await update(ref(db, `users/${data.phone}`), { name: data.name }); return res.json({ data: "Success" }); }
        if (action === 'UPDATE_PIN') { await update(ref(db, `users/${data.phone}`), { pin: data.pin }); return res.json({ data: "Success" }); }
        if (action === 'GENERATE_API') {
            const newKey = 'TP-' + Math.random().toString(36).substr(2, 6).toUpperCase() + Date.now().toString(36).substr(4, 4).toUpperCase();
            await update(ref(db, `users/${data.phone}`), { apiKey: newKey, merchantApiKey: newKey });
            return res.json({ data: newKey });
        }

        if (action === 'DEPOSIT') {
            const txnId = "DEP" + Date.now();
            const updates = {
                [`deposits/${txnId}`]: { id: txnId, userPhone: data.phone, userName: data.name, type: "DEP", amount: data.amount, utr: data.utr, status: "PENDING", timestamp: Date.now(), date: new Date().toLocaleString('en-IN') },
                [`users/${data.phone}/transactions/${txnId}`]: { id: txnId, type: "DEP", title: "Deposit Request", amount: data.amount, status: "PENDING", timestamp: Date.now(), date: new Date().toLocaleString('en-IN'), isCredit: true, sign: "+", info: "UTR: " + data.utr }
            };
            await update(ref(db), updates); 
            return res.json({ data: "Success" });
        }

        if (action === 'WITHDRAW') {
            if (data.amount < 20) throw new Error("Minimum withdrawal amount is ₹20!");
            const txnId = "WTH" + Date.now();
            const updates = {
                [`users/${data.phone}/balance`]: increment(-data.amount),
                [`withdrawals/${txnId}`]: { id: txnId, userPhone: data.phone, userName: data.name, type: "WITH", amount: data.amount, upi: data.upi, status: "PENDING", timestamp: Date.now(), date: new Date().toLocaleString('en-IN') },
                [`users/${data.phone}/transactions/${txnId}`]: { id: txnId, type: "WITH", title: "Withdrawal Request", amount: data.amount, status: "PENDING", timestamp: Date.now(), date: new Date().toLocaleString('en-IN'), isCredit: false, sign: "-", info: "UPI: " + data.upi }
            };
            await update(ref(db), updates); 
            
            const uSnap = await get(ref(db, `users/${data.phone}`));
            if(uSnap.exists() && uSnap.val().tgId) {
                await sendTgAlert(uSnap.val().tgId, `📤 Withdrawal Request\nA withdrawal request for ₹${data.amount} has been placed.`);
            }
            return res.json({ data: "Success" });
        }

        if (action === 'UPDATE_WITHDRAW_STATUS') {
            const { phone, txnId, status } = data; 
            const uRef = ref(db, `users/${phone}`);
            const uSnap = await get(uRef);
            if (!uSnap.exists()) throw new Error("User not found");
            
            const updates = {
                [`withdrawals/${txnId}/status`]: status,
                [`users/${phone}/transactions/${txnId}/status`]: status
            };

            if (status === 'REJECTED') {
                const wSnap = await get(ref(db, `withdrawals/${txnId}`));
                if (wSnap.exists()) {
                    updates[`users/${phone}/balance`] = increment(wSnap.val().amount);
                }
            }

            await update(ref(db), updates);
            
            const userData = uSnap.val();
            if (userData.tgId) {
                const wSnap = await get(ref(db, `withdrawals/${txnId}`));
                const wAmount = wSnap.exists() ? wSnap.val().amount : 0;
                
                if (status === 'SUCCESS') {
                    const msg = `👑 SWIFT PAY WALLET 👑\n\n✅ WITHDRAWAL SUCCESS\n━━━━━━━━━━━━━━━\n💸 Amount: ₹${wAmount}\n🏦 Status: Sent to Upi account\n━━━━━━━━━━━━━━━\nYour funds have been securely transferred! 🏆`;
                    await sendTgAlert(userData.tgId, msg);
                } else if (status === 'REJECTED') {
                    const msg = `👑 SWIFT PAY WALLET 👑\n\n❌ WITHDRAWAL REJECTED\n━━━━━━━━━━━━━━━\n💸 Amount: ₹${wAmount}\n🏦 Status: Refunded to Wallet\n━━━━━━━━━━━━━━━\nYour withdrawal request was rejected and funds have been returned.`;
                    await sendTgAlert(userData.tgId, msg);
                }
            }
            return res.json({ data: "Status Updated" });
        }

        if (action === 'PAY') {
            const senderSnap = await get(ref(db, `users/${data.sender}`));
            const receiverSnap = await get(ref(db, `users/${data.receiver}`));
            
            if (!receiverSnap.exists()) throw new Error("Receiver not found!");

            const now = Date.now();
            const txnIdS = `SND${now}`;
            const txnIdR = `RCV${now}`;
            
            const d = new Date(now);
            const exactTime = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, hour: 'numeric', minute: 'numeric' }).toLowerCase();
            const exactDate = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
            const formattedTime = `${exactTime} | ${exactDate}`;
            const dbDateString = d.toLocaleString('en-IN');

            const updates = {
                [`users/${data.sender}/balance`]: increment(-data.amount),
                [`users/${data.receiver}/balance`]: increment(data.amount),
                [`transactions/${txnIdS}`]: { userPhone: data.sender, receiver: data.receiver, amount: data.amount, type: 'SEND', status: 'SUCCESS', timestamp: now },
                [`transactions/${txnIdR}`]: { userPhone: data.receiver, sender: data.sender, amount: data.amount, type: 'RECEIVE', status: 'SUCCESS', timestamp: now },
                [`users/${data.sender}/transactions/${txnIdS}`]: { id: txnIdS, type: "TXN", title: "Sent Money", amount: data.amount, status: "SUCCESS", timestamp: now, date: dbDateString, isCredit: false, sign: "-", info: "To: " + data.receiver },
                [`users/${data.receiver}/transactions/${txnIdR}`]: { id: txnIdR, type: "TXN", title: "Received Money", amount: data.amount, status: "SUCCESS", timestamp: now, date: dbDateString, isCredit: true, sign: "+", info: "From: " + data.sender }
            };
            await update(ref(db), updates); 

            if(senderSnap.exists() && senderSnap.val().tgId) {
                const newBal = (Number(senderSnap.val().balance) || 0) - data.amount;
                const senderAlertMsg = `👑 Swift Pay Wallet P2P 👑\n\n✅ AMOUNT SENT SUCCESSFULLY!\n━━━━━━━━━━━━━━━\n📥 Sent To: ${data.receiver}\n💵 Amount: ₹${data.amount}\n📨 Txn ID: ${txnIdS}\n💬 Comment: P2P Transfer\n📈 Updated Balance: ₹${newBal}\n🕒 Time: ${formattedTime}\n━━━━━━━━━━━━━━━\n🔐 Processed Securely.`;
                await sendTgAlert(senderSnap.val().tgId, senderAlertMsg);
            }
            if(receiverSnap.val().tgId) {
                const newBal = (Number(receiverSnap.val().balance) || 0) + data.amount;
                const receiverAlertMsg = `👑 Swift Pay Wallet P2P 👑\n\n✅ AMOUNT RECEIVED SUCCESSFULLY!\n━━━━━━━━━━━━━━━\n📤 From: ${data.sender}\n💵 Amount: ₹${data.amount}\n📨 Txn ID: ${txnIdR}\n💬 Comment: P2P Transfer\n📈 Updated Balance: ₹${newBal}\n🕒 Time: ${formattedTime}\n━━━━━━━━━━━━━━━\n🔐 Processed Securely.`;
                await sendTgAlert(receiverSnap.val().tgId, receiverAlertMsg);
            }
            return res.json({ data: "Success" });
        }

        if (action === 'BULK_PAY') {
            const senderRef = ref(db, `users/${data.sender}`);
            const senderSnap = await get(senderRef);
            if (!senderSnap.exists()) throw new Error("Sender not found!");
            
            const totalAmount = data.amount * data.receivers.length;
            const updates = {};
            updates[`users/${data.sender}/balance`] = increment(-totalAmount);
            
            data.receivers.forEach(receiver => {
                updates[`users/${receiver}/balance`] = increment(data.amount);
                const txnIdS = `BLK${Date.now()}${Math.random().toString(36).substring(2,5)}`;
                const txnIdR = `RCV${Date.now()}${Math.random().toString(36).substring(2,5)}`;
                updates[`users/${data.sender}/transactions/${txnIdS}`] = { id: txnIdS, type: "TXN", title: "Bulk Pay Sent", amount: data.amount, status: "SUCCESS", timestamp: Date.now(), date: new Date().toLocaleString('en-IN'), isCredit: false, sign: "-", info: "To: " + receiver };
                updates[`users/${receiver}/transactions/${txnIdR}`] = { id: txnIdR, type: "TXN", title: "Received Bulk Pay", amount: data.amount, status: "SUCCESS", timestamp: Date.now(), date: new Date().toLocaleString('en-IN'), isCredit: true, sign: "+", info: "From: " + data.sender };
            });
            await update(ref(db), updates);
            return res.json({ data: "Success" });
        }

        if (action === 'CREATE_GIFT') {
            const total = data.amount * data.usersCount;
            const newCode = "TP-" + Math.random().toString(36).substring(2, 8).toUpperCase();
            
            const updates = {
                [`users/${data.phone}/balance`]: increment(-total),
                [`promoCodes/${newCode}`]: { amount: data.amount, maxUsers: data.usersCount, claimedBy: {}, status: "active", createdBy: data.phone, timestamp: Date.now() },
                [`users/${data.phone}/transactions/GEN${Date.now()}`]: { id: `GEN${Date.now()}`, type: "TXN", title: "Gift Code Create", amount: total, status: "SUCCESS", timestamp: Date.now(), date: new Date().toLocaleString('en-IN'), isCredit: false, sign: "-", info: "Code: " + newCode }
            };
            await update(ref(db), updates); 
            return res.json({ data: newCode });
        }

        if (action === 'CLAIM_GIFT') {
            const codeSnap = await get(ref(db, `promoCodes/${data.code}`));
            if (!codeSnap.exists() || codeSnap.val().status !== "active") throw new Error("Invalid or Expired Code!");
            
            const pData = codeSnap.val();
            let claimedList = pData.claimedBy || {};
            let isArray = Array.isArray(claimedList);
            let claimedCount = isArray ? claimedList.length : Object.keys(claimedList).length;

            if (isArray ? claimedList.includes(data.phone) : claimedList[data.phone]) {
                throw new Error("Already Claimed!");
            }

            if (claimedCount >= (pData.maxUsers || 1)) throw new Error("Usage Limit Reached!");

            const txnId = `CLM_${data.code}_${data.phone}`;
            const txnSnap = await get(ref(db, `users/${data.phone}/transactions/${txnId}`));
            if (txnSnap.exists()) throw new Error("Already Claimed!");

            const updates = {
                [`users/${data.phone}/balance`]: increment(pData.amount),
                [`users/${data.phone}/transactions/${txnId}`]: { id: txnId, type: "TXN", title: "Gift Code Claim", amount: pData.amount, status: "SUCCESS", timestamp: Date.now(), date: new Date().toLocaleString('en-IN'), isCredit: true, sign: "+", info: "Code: " + data.code }
            };

            if (isArray) {
                claimedList.push(data.phone);
                updates[`promoCodes/${data.code}/claimedBy`] = claimedList;
                if (claimedList.length >= (pData.maxUsers || 1)) updates[`promoCodes/${data.code}/status`] = "used";
            } else {
                updates[`promoCodes/${data.code}/claimedBy/${data.phone}`] = true;
                if ((claimedCount + 1) >= (pData.maxUsers || 1)) updates[`promoCodes/${data.code}/status`] = "used";
            }

            await update(ref(db), updates); 
            return res.json({ data: pData.amount });
        }

        if (action === 'CREATE_LIFAFA') {
            const lifafaId = "LIF" + Date.now();
            const cost = data.type === 'SCRATCH' ? data.maxAmount * data.totalUsers : data.amount * data.totalUsers;
            const updates = {
                [`users/${data.phone}/balance`]: increment(-cost),
                [`lifafas/${lifafaId}`]: {
                    id: lifafaId, type: data.type, createdBy: data.phone, telegramLinks: data.telegramLinks || [],
                    code: data.code || "", totalUsers: data.totalUsers, amount: data.amount || 0,
                    minAmount: data.minAmount || 0, maxAmount: data.maxAmount || 0, tossWin: data.tossWin || "",
                    claimedUsers: 0, status: "ACTIVE", timestamp: Date.now()
                },
                [`users/${data.phone}/transactions/${lifafaId}`]: {
                    id: lifafaId, type: "TXN", title: "Created Lifafa", amount: cost,
                    status: "SUCCESS", timestamp: Date.now(), date: new Date().toLocaleString('en-IN'),
                    isCredit: false, sign: "-", info: "Giveaway Setup"
                }
            };
            await update(ref(db), updates);
            return res.json({ data: lifafaId });
        }

        if (action === 'MY_LIFAFAS') {
            const snap = await get(ref(db, 'lifafas'));
            let myL = [];
            if (snap.exists()) {
                snap.forEach(c => { if(c.val().createdBy === data.phone) myL.push(c.val()); });
            }
            return res.json({ data: myL });
        }

        if (action === 'GET_LIFAFA_DETAILS') {
            const snap = await get(ref(db, `lifafas/${data.id}`));
            if(!snap.exists()) throw new Error("Lifafa not found");
            const l = snap.val();
            return res.json({ data: { type: l.type, telegramLinks: l.telegramLinks, hasCode: !!l.code } });
        }

        if (action === 'CLAIM_LIFAFA') {
            const lRef = ref(db, `lifafas/${data.id}`);
            const snap = await get(lRef);
            if(!snap.exists()) throw new Error("Lifafa not found");
            const l = snap.val();
            
            if(l.code && l.code !== data.code) throw new Error("Invalid Code");
            if(l.claimedUsers >= l.totalUsers) throw new Error("Lifafa Fully Claimed");
            
            const claimRef = ref(db, `lifafas/${data.id}/claims/${data.phone}`);
            const cSnap = await get(claimRef);
            if(cSnap.exists()) throw new Error("You have already claimed this giveaway!");
            
            let winAmt = l.amount;
            if(l.type === 'SCRATCH') {
                winAmt = Math.floor(Math.random() * (l.maxAmount - l.minAmount + 1)) + l.minAmount;
            } else if(l.type === 'TOSS') {
                const isWin = Math.random() > 0.5;
                if(!isWin) winAmt = 0;
            }

            if(winAmt > 0) {
                const updates = {
                    [`users/${data.phone}/balance`]: increment(winAmt),
                    [`lifafas/${data.id}/claimedUsers`]: increment(1),
                    [`lifafas/${data.id}/claims/${data.phone}`]: { amount: winAmt, timestamp: Date.now() },
                    [`users/${data.phone}/transactions/CLM${Date.now()}`]: {
                        id: `CLM${Date.now()}`, type: "TXN", title: "Claimed Lifafa", amount: winAmt,
                        status: "SUCCESS", timestamp: Date.now(), date: new Date().toLocaleString('en-IN'),
                        isCredit: true, sign: "+", info: "Giveaway Reward"
                    }
                };
                await update(ref(db), updates);
            } else {
                await update(ref(db), {
                    [`lifafas/${data.id}/claims/${data.phone}`]: { amount: 0, timestamp: Date.now() },
                    [`lifafas/${data.id}/claimedUsers`]: increment(1)
                });
            }
            return res.json({ data: { success: true, amount: winAmt } });
        }

        return res.status(400).json({ error: "Unknown Action" });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
