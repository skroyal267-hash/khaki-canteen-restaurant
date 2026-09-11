const firebaseConfig = {
  apiKey: "AIzaSyBsB4Zwu9w8ySFieI2Atz4pJqMXGMTnKr8",
  authDomain: "khaki-canteen-and-restaurant.firebaseapp.com",
  projectId: "khaki-canteen-and-restaurant",
  storageBucket: "khaki-canteen-and-restaurant.firebasestorage.app",
  messagingSenderId: "389220263925",
  appId: "1:389220263925:web:8dc04c1301649aa80fa2bc",
  measurementId: "G-PPYVHBQ81N"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const auth = firebase.auth();