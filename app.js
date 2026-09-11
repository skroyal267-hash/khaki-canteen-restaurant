let menu = [];
let cart = JSON.parse(localStorage.getItem("kc_cart") || "{}");
let user = null;
let activeCat = "All";
const DELIVERY_CHARGE = 30;
const FREE_DELIVERY_ABOVE = 500;
const RESTAURANT_UPI_ID = "9239538163@upi"; // CHANGE TO YOUR REAL UPI ID
let stopOrderListener = null;
let stopMenuListener = null;

const $ = s => document.querySelector(s);
const money = n => "₹" + Number(n || 0).toLocaleString("en-IN");

firebase.initializeApp(window.KHAKI_FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

async function init() {
  menu = await fetch("menu.json").then(r => r.json());
  renderCats();
  renderMenu();
  renderCart();

  auth.onAuthStateChanged(async u => {
    user = u;
    updateLogin();

    if (stopMenuListener) stopMenuListener();
    stopMenuListener = db.collection("menu").onSnapshot(snapshot => {
      const changes = {};
      snapshot.forEach(doc => changes[Number(doc.id)] = doc.data());
      if (Object.keys(changes).length) {
        menu = menu.map(item => changes[item.id] ? {...item, ...changes[item.id]} : item);
        renderCats(); renderMenu(); renderCart();
      }
    });

    if (u) {
      const profile = await db.collection("users").doc(u.uid).get();
      user.profile = profile.exists ? profile.data() : {};
    }
  });
}

function renderCats() {
  const cats = ["All", ...new Set(menu.filter(x => x.available !== false).map(x => x.category))];
  $("#categories").innerHTML = cats.map(c =>
    `<button class="${c === activeCat ? "active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
  ).join("");
}

function renderMenu() {
  const q = $("#search").value.toLowerCase();
  const filtered = menu.filter(x =>
    x.available !== false &&
    (activeCat === "All" || x.category === activeCat) &&
    x.name.toLowerCase().includes(q)
  );
  const groups = {};
  filtered.forEach(x => (groups[x.category] ??= []).push(x));
  $("#menu").innerHTML = Object.entries(groups).map(([cat, items]) =>
    `<div class="category-card">
      <div class="category-title">${escapeHtml(cat)}</div>
      <div class="items">
        ${items.map(x => `<div class="item">
          <img src="${x.image}" alt="${escapeHtml(x.name)}" loading="lazy">
          <div><div class="item-name">${escapeHtml(x.name)}</div><div class="price">${money(x.price)}</div></div>
          <button class="add" data-add="${x.id}">🛒 Add to Cart</button>
        </div>`).join("")}
      </div>
    </div>`
  ).join("");
}

function cartSubtotal() {
  return Object.entries(cart).reduce((sum,[id,qty]) => {
    const i = menu.find(x => x.id == id);
    return sum + (i ? i.price * qty : 0);
  }, 0);
}
function deliveryCharge() {
  const sub = cartSubtotal();
  return sub > 0 && sub < FREE_DELIVERY_ABOVE ? DELIVERY_CHARGE : 0;
}
function renderCart() {
  const entries = Object.entries(cart)
    .map(([id, qty]) => ({item: menu.find(x => x.id == id), qty}))
    .filter(x => x.item);
  let total = 0;
  $("#cartItems").innerHTML = entries.length ? entries.map(({item, qty}) => {
    subtotal += item.price * qty;
    return `<div class="cart-row">
      <img src="${item.image}" alt="">
      <div>
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="price">${money(item.price * qty)}</div>
        <div class="qty">
          <button data-minus="${item.id}">−</button>
          <span>${qty}</span>
          <button data-plus="${item.id}">+</button>
        </div>
      </div>
      <button class="add" data-remove="${item.id}">Remove</button>
    </div>`;
  }).join("") : `<div class="empty">🛒<br><br><b>No items in cart</b><br><small>Add some delicious items to get started!</small></div>`;
  const sub = cartSubtotal(), del = deliveryCharge();
  $("#cartTotal").innerHTML = entries.length
    ? `<div style="display:flex;justify-content:space-between">Subtotal <span>${money(sub)}</span></div>
       <div style="display:flex;justify-content:space-between">Delivery <span>${del ? money(del) : "FREE"}</span></div>
       <strong style="display:flex;justify-content:space-between;margin-top:7px">Grand Total <span>${money(sub+del)}</span></strong>`
    : "₹0";
  $("#cartCount").textContent = entries.reduce((a, x) => a + x.qty, 0);
  localStorage.setItem("kc_cart", JSON.stringify(cart));
}

document.addEventListener("click", async e => {
  const id = e.target.dataset.add || e.target.dataset.plus || e.target.dataset.minus || e.target.dataset.remove;
  if (id) {
    const n = Number(id);
    if (e.target.dataset.add || e.target.dataset.plus) cart[n] = (cart[n] || 0) + 1;
    if (e.target.dataset.minus) { cart[n] = (cart[n] || 1) - 1; if (cart[n] <= 0) delete cart[n]; }
    if (e.target.dataset.remove) delete cart[n];
    renderCart();
    return;
  }
  if (e.target.dataset.cat) { activeCat = e.target.dataset.cat; renderCats(); renderMenu(); }
  if (e.target.id === "loginBtn") user ? loadOrders() : openAuth();
  if (e.target.id === "cartBtn") $("#cartItems").scrollIntoView({behavior:"smooth"});
  if (e.target.id === "checkoutBtn") checkout();
  if (e.target.dataset.close) e.target.closest(".modal").classList.add("hidden");
  if (e.target.dataset.auth) {
    document.querySelectorAll(".tabs button").forEach(x => x.classList.remove("active"));
    e.target.classList.add("active");
    const register = e.target.dataset.auth === "register";
    $("#registerFields").classList.toggle("hidden", !register);
    $("#authTitle").textContent = register ? "Create account" : "Login";
    $("#authForm").dataset.mode = e.target.dataset.auth;
  }
});

$("#search").addEventListener("input", renderMenu);

function openAuth() {
  $("#authModal").classList.remove("hidden");
  $("#authForm").dataset.mode = "login";
  $("#registerFields").classList.add("hidden");
  $("#authMsg").textContent = "";
}

function updateLogin() {
  $("#loginBtn").textContent = user ? `👤 ${user.email}` : "👤 Login / Sign Up";
}

$("#authForm").onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const data = Object.fromEntries(f);
  try {
    if (e.target.dataset.mode === "register") {
      const cred = await auth.createUserWithEmailAndPassword(data.email, data.password);
      await db.collection("users").doc(cred.user.uid).set({
        name: data.name || "",
        phone: data.phone || "",
        address: data.address || "",
        email: data.email.toLowerCase(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await auth.signInWithEmailAndPassword(data.email, data.password);
    }
    $("#authModal").classList.add("hidden");
    if (Object.keys(cart).length) checkout();
  } catch (err) {
    $("#authMsg").textContent = friendlyError(err);
  }
};

async function checkout() {
  if (!Object.keys(cart).length) return alert("Your cart is empty.");
  if (!user) { openAuth(); $("#authMsg").textContent = "Please login to place your order."; return; }
  const profile = user.profile || {};
  $("#deliveryAddress").value = profile.address || "";
  $("#checkoutModal").classList.remove("hidden");
}

$("#checkoutForm").onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const items = Object.entries(cart).map(([id, qty]) => ({id: Number(id), qty: Number(qty)}));
  try {
    const clean = [];
    let total = 0;
    for (const line of items) {
      const item = menu.find(x => x.id === line.id && x.available !== false);
      if (!item) throw new Error("One selected item is currently unavailable.");
      const qty = Math.max(1, Math.min(50, line.qty));
      clean.push({id:item.id, name:item.name, price:item.price, qty});
      subtotal += item.price * qty;
    }

    const ref = db.collection("orders").doc();
    const order = {
      orderId: "KC-" + ref.id.slice(0, 8).toUpperCase(),
      customerId: user.uid,
      customerName: (user.profile && user.profile.name) || user.email.split("@")[0],
      customerEmail: user.email,
      phone: (user.profile && user.profile.phone) || "",
      items: clean,
      total,
      address: f.get("address"),
      paymentMethod: f.get("paymentMethod"),
      note: f.get("note") || "",
      status: "Pending",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await ref.set(order);
    cart = {};
    renderCart();
    $("#checkoutModal").classList.add("hidden");
    alert(`Order ${order.orderId} placed successfully! Total: ${money(order.total)}`);
    if(order.paymentMethod==="UPI"){
      location.href=`upi://pay?pa=${encodeURIComponent(RESTAURANT_UPI_ID)}&pn=${encodeURIComponent("Khaki Canteen & Restaurant")}&am=${order.total}&cu=INR&tn=${encodeURIComponent(order.orderId)}`;
    }
    loadOrders();
  } catch (err) {
    $("#checkoutMsg").textContent = friendlyError(err);
  }
};

async function loadOrders() {
  if (!user) return openAuth();
  const snap = await db.collection("orders").where("customerId", "==", user.uid).get();
  const orders = snap.docs.map(d => ({id:d.id, ...d.data()}))
    .sort((a,b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
  $("#myOrders").innerHTML = orders.length ? orders.map(o => `
    <div class="order-card">
      <b>${escapeHtml(o.orderId || o.id)}</b> <span class="status">${escapeHtml(o.status)}</span>
      <div>${new Date(timestampMs(o.createdAt)).toLocaleString()}</div>
      <div>${(o.items || []).map(i => `${escapeHtml(i.name)} × ${i.qty}`).join("<br>")}</div>
      <hr><b>Total ${money(o.total)}</b>
      <div><small>Delivery: ${escapeHtml(o.address || "")}</small></div>
    </div>`).join("") : "<p>No orders yet.</p>";
  $("#ordersModal").classList.remove("hidden");
}

function timestampMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  return Date.parse(v) || 0;
}

function friendlyError(err) {
  const map = {
    "auth/email-already-in-use":"This email is already registered.",
    "auth/invalid-email":"Please enter a valid email.",
    "auth/weak-password":"Password must be at least 6 characters.",
    "auth/invalid-credential":"Invalid email or password.",
    "auth/user-not-found":"Invalid email or password.",
    "auth/wrong-password":"Invalid email or password."
  };
  return map[err.code] || err.message || "Something went wrong.";
}

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

init();
