let menu = [];
let cart = JSON.parse(localStorage.getItem("kc_cart") || "{}");
let user = null;
let activeCat = "All";

const DELIVERY_CHARGE = 30;
const FREE_DELIVERY_ABOVE = 500;
const RESTAURANT_UPI_ID = "9239538163@upi";

let stopMenuListener = null;

const $ = (selector) => document.querySelector(selector);

function money(value) {
  return "₹" + Number(value || 0).toLocaleString("en-IN");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, function (c) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c];
  });
}

/* =========================
   FIREBASE
========================= */

firebase.initializeApp(window.KHAKI_FIREBASE_CONFIG);

const auth = firebase.auth();
const db = firebase.firestore();

/* =========================
   START APP
========================= */

async function init() {
  try {
    const response = await fetch("./menu.json");

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
       * Firebase menu listener is optional.
       * If Firebase menu collection is not configured,
       * local menu.json will still work.
       */
      try {
        stopMenuListener = db.collection("menu").onSnapshot(
          (snapshot) => {
            if (snapshot.empty) return;

            const changes = {};

            snapshot.forEach((doc) => {
              changes[Number(doc.id)] = doc.data();
            });

            menu = menu.map((item) => {
              return changes[item.id]
                ? { ...item, ...changes[item.id] }
                : item;
            });

            renderCats();
            renderMenu();
            renderCart();
          },
          () => {
            // Ignore Firebase menu listener errors.
          }
        );
      } catch (error) {
        // Local menu.json continues working.
      }

      if (u) {
        try {
          const profile = await db.collection("users").doc(u.uid).get();

          u.profile = profile.exists ? profile.data() : {};
        } catch (error) {
          u.profile = {};
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
          Please make sure <b>menu.json</b> is uploaded correctly.
        </div>
      `;
    }
  }
}

/* =========================
   CATEGORIES
========================= */

function renderCats() {
  const categories = [
    "All",
    ...new Set(
      menu
        .filter((item) => item.available !== false)
        .map((item) => item.category)
    )
  ];

  $("#categories").innerHTML = categories
    .map(
      (category) => `
        <button
          class="${category === activeCat ? "active" : ""}"
          data-cat="${escapeHtml(category)}">
          ${escapeHtml(category)}
        </button>
      `
    )
    .join("");
}

/* =========================
   MENU
========================= */

function renderMenu() {
  const searchBox = $("#search");

  const query = searchBox
    ? searchBox.value.toLowerCase().trim()
    : "";

  const filtered = menu.filter((item) => {
    const available = item.available !== false;

    const categoryMatch =
      activeCat === "All" || item.category === activeCat;

    const searchMatch =
      item.name.toLowerCase().includes(query);

    return available && categoryMatch && searchMatch;
  });

  const groups = {};

  filtered.forEach((item) => {
    if (!groups[item.category]) {
      groups[item.category] = [];
    }

    groups[item.category].push(item);
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
      ([category, items]) => `
        <div class="category-card">

          <div class="category-title">
            ${escapeHtml(category)}
          </div>

          <div class="items">

            ${items
              .map(
                (item) => `
                  <div class="item">

                    <img
                      src="${escapeHtml(item.image)}"
                      alt="${escapeHtml(item.name)}"
                      loading="lazy"
                      onerror="this.src='assets/food-banner.jpg'"
                    >

                    <div>
                      <div class="item-name">
                        ${escapeHtml(item.name)}
                      </div>

                      <div class="price">
                        ${money(item.price)}
                      </div>
                    </div>

                    <button
                      class="add"
                      data-add="${item.id}">
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

/* =========================
   CART CALCULATIONS
========================= */

function cartSubtotal() {
  return Object.entries(cart).reduce(
    (sum, [id, quantity]) => {
      const item = menu.find((x) => x.id == id);

      if (!item) return sum;

      return sum + Number(item.price) * Number(quantity);
    },
    0
  );
}

function deliveryCharge() {
  const subtotal = cartSubtotal();

  if (subtotal === 0) return 0;

  return subtotal >= FREE_DELIVERY_ABOVE
    ? 0
    : DELIVERY_CHARGE;
}

/* =========================
   CART
========================= */

function renderCart() {
  const entries = Object.entries(cart)
    .map(([id, quantity]) => ({
      item: menu.find((x) => x.id == id),
      quantity: Number(quantity)
    }))
    .filter((x) => x.item && x.quantity > 0);

  if (entries.length) {
    $("#cartItems").innerHTML = entries
      .map(
        ({ item, quantity }) => `
          <div class="cart-row">

            <img
              src="${escapeHtml(item.image)}"
              alt="${escapeHtml(item.name)}"
              onerror="this.src='assets/food-banner.jpg'"
            >

            <div>

              <div class="item-name">
                ${escapeHtml(item.name)}
              </div>

              <div class="price">
                ${money(item.price * quantity)}
              </div>

              <div class="qty">

                <button data-minus="${item.id}">
                  −
                </button>

                <span>
                  ${quantity}
                </span>

                <button data-plus="${item.id}">
                  +
                </button>

              </div>

            </div>

            <button
              class="add"
              data-remove="${item.id}">
              Remove
            </button>

          </div>
        `
      )
      .join("");
  } else {
    $("#cartItems").innerHTML = `
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
  }

  const subtotal = cartSubtotal();
  const delivery = deliveryCharge();
  const grandTotal = subtotal + delivery;

  if (entries.length) {
    $("#cartTotal").innerHTML = `
      <div style="display:flex;justify-content:space-between">
        <span>Subtotal</span>
        <span>${money(subtotal)}</span>
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
        ">
        <span>Grand Total</span>
        <span>${money(grandTotal)}</span>
      </strong>
    `;
  } else {
    $("#cartTotal").textContent = "₹0";
  }

  const count = entries.reduce(
    (total, item) => total + item.quantity,
    0
  );

  $("#cartCount").textContent = count;

  localStorage.setItem(
    "kc_cart",
    JSON.stringify(cart)
  );
}

/* =========================
   BUTTON EVENTS
========================= */

document.addEventListener("click", async (event) => {
  const target = event.target;

  const addId = target.dataset.add;
  const plusId = target.dataset.plus;
  const minusId = target.dataset.minus;
  const removeId = target.dataset.remove;
  const category = target.dataset.cat;

  if (addId) {
    const id = Number(addId);

    cart[id] = (cart[id] || 0) + 1;

    renderCart();

    return;
  }

  if (plusId) {
    const id = Number(plusId);

    cart[id] = (cart[id] || 0) + 1;

    renderCart();

    return;
  }

  if (minusId) {
    const id = Number(minusId);

    cart[id] = (cart[id] || 1) - 1;

    if (cart[id] <= 0) {
      delete cart[id];
    }

    renderCart();

    return;
  }

  if (removeId) {
    const id = Number(removeId);

    delete cart[id];

    renderCart();

    return;
  }

  if (category) {
    activeCat = category;

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

  if (target.dataset.close !== undefined) {
    target
      .closest(".modal")
      .classList.add("hidden");

    return;
  }

  if (target.dataset.auth) {
    document
      .querySelectorAll(".tabs button")
      .forEach((button) => {
        button.classList.remove("active");
      });

    target.classList.add("active");

    const register =
      target.dataset.auth === "register";

    $("#registerFields").classList.toggle(
      "hidden",
      !register
    );

    $("#authTitle").textContent =
      register
        ? "Create account"
        : "Login";

    $("#authForm").dataset.mode =
      target.dataset.auth;

    $("#authMsg").textContent = "";

    return;
  }
});

/* =========================
   SEARCH
========================= */

const searchBox = $("#search");

if (searchBox) {
  searchBox.addEventListener(
    "input",
    renderMenu
  );
}

/* =========================
   AUTH
========================= */

function openAuth() {
  $("#authModal").classList.remove(
    "hidden"
  );

  $("#authForm").dataset.mode = "login";

  $("#registerFields").classList.add(
    "hidden"
  );

  $("#authTitle").textContent = "Login";

  $("#authMsg").textContent = "";
}

function updateLogin() {
  $("#loginBtn").textContent = user
    ? `👤 ${user.email}`
    : "👤 Login / Sign Up";
}

$("#authForm").onsubmit = async (event) => {
  event.preventDefault();

  const form = new FormData(event.target);

  const data = Object.fromEntries(form);

  $("#authMsg").textContent =
    "Please wait...";

  try {
    if (
      event.target.dataset.mode ===
      "register"
    ) {
      const credential =
        await auth.createUserWithEmailAndPassword(
          data.email,
          data.password
        );

      await db
        .collection("users")
        .doc(credential.user.uid)
        .set({
          name: data.name || "",
          phone: data.phone || "",
          address: data.address || "",
          email: data.email.toLowerCase(),
          createdAt:
            firebase.firestore.FieldValue.serverTimestamp()
        });

      credential.user.profile = {
        name: data.name || "",
        phone: data.phone || "",
        address: data.address || ""
      };
    } else {
      await auth.signInWithEmailAndPassword(
        data.email,
        data.password
      );
    }

    $("#authModal").classList.add(
      "hidden"
    );

    if (Object.keys(cart).length) {
      checkout();
    }
  } catch (error) {
    $("#authMsg").textContent =
      friendlyError(error);
  }
};

/* =========================
   CHECKOUT
========================= */

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

  const profile =
    user.profile || {};

  $("#deliveryAddress").value =
    profile.address || "";

  $("#checkoutMsg").textContent = "";

  $("#checkoutModal").classList.remove(
    "hidden"
  );
}

/* =========================
   PLACE ORDER
========================= */

$("#checkoutForm").onsubmit = async (event) => {
  event.preventDefault();

  if (!user) {
    openAuth();
    return;
  }

  const form = new FormData(event.target);

  const address =
    String(form.get("address") || "").trim();

  if (!address) {
    $("#checkoutMsg").textContent =
      "Please enter your delivery address.";

    return;
  }

  const selectedItems = Object.entries(cart);

  try {
    const cleanItems = [];

    let subtotal = 0;

    for (const [id, quantity] of selectedItems) {
      const item = menu.find(
        (x) =>
          x.id == id &&
          x.available !== false
      );

      if (!item) {
        throw new Error(
          "One selected item is currently unavailable."
        );
      }

      const qty = Math.max(
        1,
        Math.min(50, Number(quantity))
      );

      cleanItems.push({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        qty: qty
      });

      subtotal +=
        Number(item.price) * qty;
    }

    const delivery =
      subtotal >= FREE_DELIVERY_ABOVE
        ? 0
        : DELIVERY_CHARGE;

    const total =
      subtotal + delivery;

    const ref =
      db.collection("orders").doc();

    const order = {
      orderId:
        "KC-" +
        ref.id
          .slice(0, 8)
          .toUpperCase(),

      customerId: user.uid,

      customerName:
        (user.profile &&
          user.profile.name) ||
        user.email.split("@")[0],

      customerEmail:
        user.email,

      phone:
        (user.profile &&
          user.profile.phone) ||
        "",

      items: cleanItems,

      subtotal: subtotal,

      deliveryCharge: delivery,

      total: total,

      address: address,

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

    $("#checkoutForm").reset();

    $("#checkoutModal").classList.add(
      "hidden"
    );

    alert(
      `Order ${order.orderId} placed successfully!\nTotal: ${money(order.total)}`
    );

    if (
      order.paymentMethod === "UPI"
    ) {
      const upiUrl =
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

      window.location.href = upiUrl;
    }

    loadOrders();
  } catch (error) {
    console.error(error);

    $("#checkoutMsg").textContent =
      friendlyError(error);
  }
};

/* =========================
   MY ORDERS
========================= */

async function loadOrders() {
  if (!user) {
    openAuth();
    return;
  }

  try {
    const snapshot =
      await db
        .collection("orders")
        .where(
          "customerId",
          "==",
          user.uid
        )
        .get();

    const orders =
      snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data()
        }))
        .sort(
          (a, b) =>
            timestampMs(b.createdAt) -
            timestampMs(a.createdAt)
        );

    if (!orders.length) {
      $("#myOrders").innerHTML =
        "<p>No orders yet.</p>";
    } else {
      $("#myOrders").innerHTML =
        orders
          .map(
            (order) => `
              <div class="order-card">

                <b>
                  ${escapeHtml(
                    order.orderId ||
                      order.id
                  )}
                </b>

                <span class="status">
                  ${escapeHtml(
                    order.status ||
                      "Pending"
                  )}
                </span>

                <div>
                  ${formatDate(
                    order.createdAt
                  )}
                </div>

                <div>
                  ${(order.items || [])
                    .map(
                      (item) =>
                        `${escapeHtml(
                          item.name
                        )} × ${item.qty}`
                    )
                    .join("<br>")}
                </div>

                <hr>

                <b>
                  Total
                  ${money(order.total)}
                </b>

                <div>
                  <small>
                    Delivery:
                    ${escapeHtml(
                      order.address ||
                        ""
                    )}
                  </small>
                </div>

              </div>
            `
          )
          .join("");
    }

    $("#ordersModal").classList.remove(
      "hidden"
    );
  } catch (error) {
    alert(
      "Could not load orders. Please try again."
    );
  }
}

/* =========================
   DATE
========================= */

function timestampMs(value) {
  if (!value) return 0;

  if (
    typeof value.toMillis ===
    "function"
  ) {
    return value.toMillis();
  }

  return Date.parse(value) || 0;
}

function formatDate(value) {
  const ms = timestampMs(value);

  if (!ms) {
    return "Just now";
  }

  return new Date(ms).toLocaleString(
    "en-IN"
  );
}

/* =========================
   ERRORS
========================= */

function friendlyError(error) {
  const errors = {
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
      "Invalid email or password.",

    "permission-denied":
      "Permission denied by Firebase."
  };

  return (
    errors[error.code] ||
    error.message ||
    "Something went wrong."
  );
}

/* =========================
   RUN
========================= */

init();
