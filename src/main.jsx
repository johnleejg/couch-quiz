import React from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "@fontsource/archivo-black/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/dm-sans/800.css";
import App from "./App";
import "./styles.css";

const socket = io();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App socket={socket} />
  </React.StrictMode>,
);
