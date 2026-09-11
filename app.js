let menu = [];
let cart = JSON.parse(localStorage.getItem("kc_cart") || "{}");
let user = null;
let activeCat = "All";

const DELIVERY_CHARGE = 30;
const FREE_DELIVERY_ABOVE = 500;
const RESTAURANT_UPI_ID = "9239538163@upi";

let stopOrderListener = null;
let stopMenuListener = null;

const $ = (s) => document.querySelector(s);

const money = (n) =>
  "₹" + Number(n || 0).toLocaleString("en-IN");

/* --------------------------------------------------
   FIREBASE CONFIG
   -------------------------------------------------- */

const firebaseConfig = {
  apiKey: "AIzaSyBsB4Zwu9w8ySFieI2Atz4pJqMXGMTnKr8",
  authDomain: "khaki-canteen-and-restaurant.firebaseapp.com",
  projectId: "khaki-canteen-and-restaurant",
  storageBucket: "khaki-canteen-and-restaurant.firebasestorage.app",
  messagingSenderId: "389220263925",
  appId: "1:389220263925:web:8dc04c1301649aa80fa2bc",
  measurementId: "G-PPYVHBQ81N"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

/* --------------------------------------------------
   BASE PATH
   Works on GitHub Pages project URL
   -------------------------------------------------- */

const BASE_PATH = window.location.pathname
  .substring(0, window.location.pathname.lastIndexOf("/") + 1);

/* --------------------------------------------------
   IMAGE PATH FIX
   -------------------------------------------------- */

function imagePath(path) {
  if (!path) return "";

  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:")
  ) {
    return path;
  }

  path = path.replace(/^\/+/, "");

  if (path.startsWith("assets/")) {
    return BASE_PATH + path;
  }

  return BASE_PATH + "assets/" + path;
}

/* --------------------------------------------------
   INITIALIZE
   -------------------------------------------------- */

async function init() {
  try {
    const response = await fetch(BASE_PATH + "menu.json", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("menu.json could not be loaded.");
    }

    menu = await response.json();

    renderCats();
    renderMenu();
    renderCart();

    auth.onAuthStateChanged(async (u) => {
      user = u;

      updateLogin();

      if (stopMenuListener) {
        stopMenuListener();
        stopMenuListener = null;
      }

      /*
        Firebase menu collection is optional.
        If it exists, it can override menu availability/prices.
      */

      try {
        stopMenuListener = db
          .collection("menu")
          .onSnapshot(
            (snapshot) => {
              const changes = {};

              snapshot.forEach((doc) => {
                changes[Number(doc.id)] = doc.data();
              });

              if (Object.keys(changes).length) {
                menu = menu.map((item) =>
                  changes[item.id]
                    ? { ...item, ...changes[item.id] }
                    : item
                );

                renderCats();
                renderMenu();
                renderCart();
              }
            },
            (error) => {
              console.warn("Menu Firestore listener:", error);
            }
          );
      } catch (error) {
        console.warn("Menu listener unavailable:", error);
      }

      if (u) {
        try {
          const profile = await db
            .collection("users")
            .doc(u.uid)
            .get();

          u.profile = profile.exists ? profile.data() : {};
        } catch (error) {
          u.profile = {};
          console.warn("Profile loading error:", error);
        }
      }
    });

  } catch (error) {
    console.error(error);

    const menuBox = $("#menu");

    if (menuBox) {
      menuBox.innerHTML = `
        <div class="empty">
          <b>Menu could not be loaded.</b>
          <br><br>
          Please make sure <b>menu.json</b> is uploaded
          in the same folder as index.html.
        </div>
      `;
    }
  }
}

/* --------------------------------------------------
   CATEGORIES
   -------------------------------------------------- */

function renderCats() {
  const cats = [
    "All",
    ...new Set(
      menu
        .filter((x) => x.available !== false)
        .map((x) => x.category)
    )
  ];

  $("#categories").innerHTML = cats
    .map(
      (c) => `
        <button
          class="${c === activeCat ? "active" : ""}"
          data-cat="${escapeHtml(c)}"
        >
          ${escapeHtml(c)}
        </button>
      `
    )
    .join("");
}

/* --------------------------------------------------
   MENU
   -------------------------------------------------- */

function renderMenu() {
  const searchInput = $("#search");

  const q = searchInput
    ? searchInput.value.toLowerCase().trim()
    : "";

  const filtered = menu.filter((x) => {
    const available = x.available !== false;
    const category =
      activeCat === "All" || x.category === activeCat;
    const search =
      !q || String(x.name).toLowerCase().includes(q);

    return available && category && search;
  });

  const groups = {};

  filtered.forEach((x) => {
    if (!groups[x.category]) {
      groups[x.category] = [];
    }

    groups[x.category].push(x);
  });

  if (!Object.keys(groups).length) {
    $("#menu").innerHTML = `
      <div class="empty">
        <b>No food items found.</b>
      </div>
    `;
    return;
  }

  $("#menu").innerHTML = Object.entries(groups)
    .map(
      ([cat, items]) => `
        <div class="category-card">
          <div class="category-title">
            ${escapeHtml(cat)}
          </div>

          <div class="items">

            ${items
              .map(
                (x) => `
                  <div class="item">

                    <img
                      src="${escapeAttribute(imagePath(x.image))}"
                      alt="${escapeHtml(x.name)}"
                      loading="lazy"
                      onerror="this.style.display='none'"
                    >

                    <div>
                      <div class="item-name">
                        ${escapeHtml(x.name)}
                      </div>

                      <div class="price">
                        ${money(x.price)}
                      </div>
                    </div>

                    <button
                      class="add"
                      data-add="${x.id}"
                    >
                      🛒 Add to Cart
                    </button>

                  </div>
                `
              )
              .join("")}

          </div>
        </div>
      `
    )
    .join("");
}

/* --------------------------------------------------
   CART CALCULATIONS
   -------------------------------------------------- */

function cartSubtotal() {
  return Object.entries(cart).reduce(
    (sum, [id, qty]) => {
      const item = menu.find((x) => x.id == id);

      return (
        sum +
        (item ? Number(item.price) * Number(qty) : 0)
      );
    },
    0
  );
}

function deliveryCharge() {
  const sub = cartSubtotal();

  return sub > 0 && sub < FREE_DELIVERY_ABOVE
    ? DELIVERY_CHARGE
    : 0;
}

/* --------------------------------------------------
   CART DISPLAY
   -------------------------------------------------- */

function renderCart() {
  const entries = Object.entries(cart)
    .map(([id, qty]) => ({
      item: menu.find((x) => x.id == id),
      qty: Number(qty)
    }))
    .filter((x) => x.item);

  $("#cartItems").innerHTML = entries.length
    ? entries
        .map(({ item, qty }) => {
          const subtotal = Number(item.price) * qty;

          return `
            <div class="cart-row">

              <img
                src="${escapeAttribute(imagePath(item.image))}"
                alt=""
                onerror="this.style.display='none'"
              >

              <div>

                <div class="item-name">
                  ${escapeHtml(item.name)}
                </div>

                <div class="price">
                  ${money(subtotal)}
                </div>

                <div class="qty">

                  <button data-minus="${item.id}">
                    −
                  </button>

                  <span>${qty}</span>

                  <button data-plus="${item.id}">
                    +
                  </button>

                </div>

              </div>

              <button
                class="add"
                data-remove="${item.id}"
              >
                Remove
              </button>

            </div>
          `;
        })
        .join("")
    : `
      <div class="empty">
        🛒
        <br><br>
        <b>No items in cart</b>
        <br>
        <small>
          Add some delicious items to get started!
        </small>
      </div>
    `;

  const sub = cartSubtotal();
  const delivery = deliveryCharge();
  const grandTotal = sub + delivery;

  $("#cartTotal").innerHTML = entries.length
    ? `
      <div style="display:flex;justify-content:space-between">
        <span>Subtotal</span>
        <span>${money(sub)}</span>
      </div>

      <div style="display:flex;justify-content:space-between">
        <span>Delivery</span>
        <span>
          ${delivery ? money(delivery) : "FREE"}
        </span>
      </div>

      <strong
        style="
          display:flex;
          justify-content:space-between;
          margin-top:7px
        "
      >
        <span>Grand Total</span>
        <span>${money(grandTotal)}</span>
      </strong>
    `
    : "₹0";

  $("#cartCount").textContent = entries.reduce(
    (sum, x) => sum + x.qty,
    0
  );

  localStorage.setItem(
    "kc_cart",
    JSON.stringify(cart)
  );
}

/* --------------------------------------------------
   CLICK EVENTS
   -------------------------------------------------- */

document.addEventListener("click", async (e) => {
  const target = e.target;

  const id =
    target.dataset.add ||
    target.dataset.plus ||
    target.dataset.minus ||
    target.dataset.remove;

  if (id) {
    const n = Number(id);

    if (target.dataset.add || target.dataset.plus) {
      cart[n] = (cart[n] || 0) + 1;
    }

    if (target.dataset.minus) {
      cart[n] = (cart[n] || 1) - 1;

      if (cart[n] <= 0) {
        delete cart[n];
      }
    }

    if (target.dataset.remove) {
      delete cart[n];
    }

    renderCart();
    return;
  }

  if (target.dataset.cat) {
    activeCat = target.dataset.cat;

    renderCats();
    renderMenu();

    return;
  }

  if (target.id === "loginBtn") {
    if (user) {
      loadOrders();
    } else {
      openAuth();
    }

    return;
  }

  if (target.id === "cartBtn") {
    $("#cartItems").scrollIntoView({
      behavior: "smooth"
    });

    return;
  }

  if (target.id === "checkoutBtn") {
    checkout();
    return;
  }

  if (target.dataset.close) {
    const modal = target.closest(".modal");

    if (modal) {
      modal.classList.add("hidden");
    }

    return;
  }

  if (target.dataset.auth) {
    document
      .querySelectorAll(".tabs button")
      .forEach((x) =>
        x.classList.remove("active")
      );

    target.classList.add("active");

    const register =
      target.dataset.auth === "register";

    $("#registerFields").classList.toggle(
      "hidden",
      !register
    );

    $("#authTitle").textContent = register
      ? "Create account"
      : "Login";

    $("#authForm").dataset.mode =
      target.dataset.auth;

    return;
  }
});

/* --------------------------------------------------
   SEARCH
   -------------------------------------------------- */

const searchBox = $("#search");

if (searchBox) {
  searchBox.addEventListener(
    "input",
    renderMenu
  );
}

/* --------------------------------------------------
   AUTH
   -------------------------------------------------- */

function openAuth() {
  $("#authModal").classList.remove("hidden");

  $("#authForm").dataset.mode = "login";

  $("#registerFields").classList.add("hidden");

  $("#authMsg").textContent = "";
}

function updateLogin() {
  $("#loginBtn").textContent = user
    ? `👤 ${user.email}`
    : "👤 Login / Sign Up";
}

$("#authForm").onsubmit = async (e) => {
  e.preventDefault();

  const form = new FormData(e.target);
  const data = Object.fromEntries(form);

  try {
    if (
      e.target.dataset.mode === "register"
    ) {
      const cred =
        await auth.createUserWithEmailAndPassword(
          data.email,
          data.password
        );

      await db
        .collection("users")
        .doc(cred.user.uid)
        .set({
          name: data.name || "",
          phone: data.phone || "",
          address: data.address || "",
          email: data.email.toLowerCase(),
          createdAt:
            firebase.firestore.FieldValue.serverTimestamp()
        });

      cred.user.profile = {
        name: data.name || "",
        phone: data.phone || "",
        address: data.address || "",
        email: data.email.toLowerCase()
      };
    } else {
      await auth.signInWithEmailAndPassword(
        data.email,
        data.password
      );
    }

    $("#authModal").classList.add("hidden");

    if (Object.keys(cart).length) {
      checkout();
    }
  } catch (err) {
    $("#authMsg").textContent =
      friendlyError(err);
  }
};

/* --------------------------------------------------
   CHECKOUT
   -------------------------------------------------- */

async function checkout() {
  if (!Object.keys(cart).length) {
    alert("Your cart is empty.");
    return;
  }

  if (!user) {
    openAuth();

    $("#authMsg").textContent =
      "Please login to place your order.";

    return;
  }

  const profile = user.profile || {};

  $("#deliveryAddress").value =
    profile.address || "";

  $("#checkoutMsg").textContent = "";

  $("#checkoutModal").classList.remove(
    "hidden"
  );
}

/* --------------------------------------------------
   PLACE ORDER
   -------------------------------------------------- */

$("#checkoutForm").onsubmit = async (e) => {
  e.preventDefault();

  const form = new FormData(e.target);

  const items = Object.entries(cart).map(
    ([id, qty]) => ({
      id: Number(id),
      qty: Number(qty)
    })
  );

  try {
    const clean = [];
    let subtotal = 0;

    for (const line of items) {
      const item = menu.find(
        (x) =>
          x.id === line.id &&
          x.available !== false
      );

      if (!item) {
        throw new Error(
          "One selected item is currently unavailable."
        );
      }

      const qty = Math.max(
        1,
        Math.min(50, line.qty)
      );

      clean.push({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        qty
      });

      subtotal +=
        Number(item.price) * qty;
    }

    const delivery =
      subtotal > 0 &&
      subtotal < FREE_DELIVERY_ABOVE
        ? DELIVERY_CHARGE
        : 0;

    const grandTotal =
      subtotal + delivery;

    const ref =
      db.collection("orders").doc();

    const order = {
      orderId:
        "KC-" +
        ref.id.slice(0, 8).toUpperCase(),

      customerId: user.uid,

      customerName:
        (user.profile &&
          user.profile.name) ||
        user.email.split("@")[0],

      customerEmail: user.email,

      phone:
        (user.profile &&
          user.profile.phone) ||
        "",

      items: clean,

      subtotal,

      deliveryCharge: delivery,

      total: grandTotal,

      address:
        form.get("address") || "",

      paymentMethod:
        form.get("paymentMethod") ||
        "Cash on Delivery",

      note:
        form.get("note") || "",

      status: "Pending",

      createdAt:
        firebase.firestore.FieldValue.serverTimestamp(),

      updatedAt:
        firebase.firestore.FieldValue.serverTimestamp()
    };

    await ref.set(order);

    cart = {};

    renderCart();

    $("#checkoutModal").classList.add(
      "hidden"
    );

    alert(
      `Order ${order.orderId} placed successfully! Total: ${money(
        order.total
      )}`
    );

    if (
      order.paymentMethod === "UPI"
    ) {
      location.href =
        `upi://pay?pa=${encodeURIComponent(
          RESTAURANT_UPI_ID
        )}` +
        `&pn=${encodeURIComponent(
          "Khaki Canteen & Restaurant"
        )}` +
        `&am=${order.total}` +
        `&cu=INR` +
        `&tn=${encodeURIComponent(
          order.orderId
        )}`;
    }

    loadOrders();
  } catch (err) {
    console.error(err);

    $("#checkoutMsg").textContent =
      friendlyError(err);
  }
};

/* --------------------------------------------------
   CUSTOMER ORDERS
   -------------------------------------------------- */

async function loadOrders() {
  if (!user) {
    openAuth();
    return;
  }

  try {
    const snap = await db
      .collection("orders")
      .where(
        "customerId",
        "==",
        user.uid
      )
      .get();

    const orders = snap.docs
      .map((d) => ({
        id: d.id,
        ...d.data()
      }))
      .sort(
        (a, b) =>
          timestampMs(b.createdAt) -
          timestampMs(a.createdAt)
      );

    $("#myOrders").innerHTML =
      orders.length
        ? orders
            .map(
              (o) => `
                <div class="order-card">

                  <b>
                    ${escapeHtml(
                      o.orderId || o.id
                    )}
                  </b>

                  <span class="status">
                    ${escapeHtml(
                      o.status || "Pending"
                    )}
                  </span>

                  <div>
                    ${new Date(
                      timestampMs(
                        o.createdAt
                      )
                    ).toLocaleString()}
                  </div>

                  <div>
                    ${(o.items || [])
                      .map(
                        (i) =>
                          `${escapeHtml(
                            i.name
                          )} × ${i.qty}`
                      )
                      .join("<br>")}
                  </div>

                  <hr>

                  <b>
                    Total ${money(o.total)}
                  </b>

                  <div>
                    <small>
                      Delivery:
                      ${escapeHtml(
                        o.address || ""
                      )}
                    </small>
                  </div>

                </div>
              `
            )
            .join("")
        : "<p>No orders yet.</p>";

    $("#ordersModal").classList.remove(
      "hidden"
    );
  } catch (error) {
    console.error(error);

    alert(
      "Could not load your orders."
    );
  }
}

/* --------------------------------------------------
   TIMESTAMP
   -------------------------------------------------- */

function timestampMs(v) {
  if (!v) return 0;

  if (
    typeof v.toMillis === "function"
  ) {
    return v.toMillis();
  }

  return Date.parse(v) || 0;
}

/* --------------------------------------------------
   FRIENDLY FIREBASE ERRORS
   -------------------------------------------------- */

function friendlyError(err) {
  const map = {
    "auth/email-already-in-use":
      "This email is already registered.",

    "auth/invalid-email":
      "Please enter a valid email.",

    "auth/weak-password":
      "Password must be at least 6 characters.",

    "auth/invalid-credential":
      "Invalid email or password.",

    "auth/user-not-found":
      "Invalid email or password.",

    "auth/wrong-password":
      "Invalid email or password."
  };

  return (
    map[err.code] ||
    err.message ||
    "Something went wrong."
  );
}

/* --------------------------------------------------
   HTML SAFETY
   -------------------------------------------------- */

function escapeHtml(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[c])
  );
}

function escapeAttribute(v) {
  return escapeHtml(v);
}

/* --------------------------------------------------
   START
   -------------------------------------------------- */

init();
