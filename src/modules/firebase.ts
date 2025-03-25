import { getAnalytics } from "firebase/analytics"
import { initializeApp } from "firebase/app"

const firebaseConfig = {
  apiKey: "AIzaSyA_rIOA70xgfZz1YvY21y3g5eml4-5OYaM",
  authDomain: "hyperjump-app.firebaseapp.com",
  databaseURL: "https://hyperjump-app.firebaseio.com",
  projectId: "hyperjump-app",
  storageBucket: "hyperjump-app.appspot.com",
  messagingSenderId: "459536818593",
  appId: "1:459536818593:web:c467b34cd6b9cb77f6abe0",
  measurementId: "G-SXL6PEFB2F",
}

const firebaseApp = initializeApp(firebaseConfig)
const analytics = getAnalytics(firebaseApp)

export { analytics, firebaseApp }
