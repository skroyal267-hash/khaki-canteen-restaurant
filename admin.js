firebase.initializeApp(window.KHAKI_FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();
const ADMIN_EMAIL = window.KHAKI_ADMIN_EMAIL;
let menu = [];
let stopOrders = null;
let stopMenu = null;

const $ = s => document.querySelector(s);
const money = n => "₹" + Number(n || 0).toLocaleString("en-IN");
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

async function loadMenu() {
  menu = await fetch("menu.json").then(r => r.json());
  const snap = await db.collection("menu").get();
  snap.forEach(doc => {
    const id = Number(doc.id);
    const i = menu.findIndex(x => x.id === id);
    if (i >= 0) menu[i] = {...menu[i], ...doc.data()};
  });
  renderMenu();
}

function renderMenu() {
  $("#adminMenu").innerHTML = menu.map(x => `
    <div class="category-card">
      <div class="category-title">${esc(x.category)}</div>
      <div class="items">
        <div class="item">
          <img src="${x.image}" alt="">
          <div><b>${esc(x.name)}</b><div class="price">${money(x.price)}</div></div>
          <label><input type="checkbox" data-menu="${x.id}" ${x.available !== false ? "checked" : ""}> Available</label>
        </div>
      </div>
    </div>`).join("");
}

function playNewOrderSound(){
  try{
    const C=window.AudioContext||window.webkitAudioContext;if(!C)return;
    const c=new C(),o=c.createOscillator(),g=c.createGain();
    o.connect(g);g.connect(c.destination);o.frequency.value=880;g.gain.value=.08;
    o.start();o.stop(c.currentTime+.25);
  }catch(_){}
}
function startLiveOrders() {
  if (stopOrders) stopOrders();
  stopOrders = db.collection("orders").onSnapshot(snapshot => {
    const orders = snapshot.docs.map(d => ({id:d.id, ...d.data()}))
      .sort((a,b) => time(b.createdAt) - time(a.createdAt));
    renderOrders(orders);
  }, err => $("#adminMsg").textContent = err.message);
}

function renderOrders(orders) {
  $("#orders").innerHTML = orders.length ? orders.map(o => `
    <div class="order-card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div>
          <b>${esc(o.orderId || o.id)}</b><br>
          👤 ${esc(o.customerName || "")}<br>
          📞 ${esc(o.phone || "")}<br>
          📧 ${esc(o.customerEmail || "")}<br>
          📍 ${esc(o.address || "")}
        </div>
        <div>
          <b>${money(o.total)}</b><br>
          <select data-order="${o.id}">
            ${["Pending","Accepted","Preparing","Out for Delivery","Delivered","Cancelled"].map(s =>
              `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
      </div>
      <hr>
      ${(o.items || []).map(i => `${esc(i.name)} × ${i.qty} — ${money(i.price * i.qty)}`).join("<br>")}
      <br><small>${new Date(time(o.createdAt)).toLocaleString()} • ${esc(o.paymentMethod || "")}</small>
      ${o.note ? `<br><small>📝 ${esc(o.note)}</small>` : ""}
    </div>`).join("") : "<p>No customer orders yet.</p>";
}

function time(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  return Date.parse(v) || 0;
}

$("#adminLogin").onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const email = String(f.get("email")).trim().toLowerCase();
  const password = f.get("password");
  try {
    if (email !== ADMIN_EMAIL.toLowerCase()) throw new Error("This email is not the configured admin email.");
    await auth.signInWithEmailAndPassword(email, password);
  } catch (err) {
    $("#adminMsg").textContent = err.message;
  }
};

auth.onAuthStateChanged(async u => {
  if (u && u.email && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    $("#loginBox").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    await loadMenu();
    startLiveOrders();

    if (stopMenu) stopMenu();
    stopMenu = db.collection("menu").onSnapshot(s => {
      s.forEach(doc => {
        const id = Number(doc.id);
        const i = menu.findIndex(x => x.id === id);
        if (i >= 0) menu[i] = {...menu[i], ...doc.data()};
      });
      renderMenu();
    });
  } else {
    $("#loginBox").classList.remove("hidden");
    $("#dashboard").classList.add("hidden");
    if (u) await auth.signOut();
  }
});

$("#orders").addEventListener("change", async e => {
  if (!e.target.dataset.order) return;
  try {
    await db.collection("orders").doc(e.target.dataset.order).update({
      status: e.target.value,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    alert(err.message);
  }
});

$("#adminMenu").addEventListener("change", async e => {
  if (!e.target.dataset.menu) return;
  try {
    await db.collection("menu").doc(String(e.target.dataset.menu)).set({
      available: e.target.checked,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge:true});
  } catch (err) {
    alert(err.message);
  }
});

$("#seedMenu").onclick = async () => {
  try {
    const batch = db.batch();
    menu.forEach(x => batch.set(db.collection("menu").doc(String(x.id)), {
      category:x.category, name:x.name, price:x.price, image:x.image,
      available:x.available !== false,
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    }, {merge:true}));
    await batch.commit();
    $("#seedMsg").textContent = "Menu synced successfully.";
  } catch (err) {
    $("#seedMsg").textContent = err.message;
  }
};

$("#logout").onclick = () => auth.signOut();
