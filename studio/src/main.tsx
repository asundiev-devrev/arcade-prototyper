import React from "react";
import ReactDOM from "react-dom/client";
import "@xorkavi/arcade-gen/styles.css";
import "./styles/tailwind.css";
import "./styles/arcade-gen-patches.css";
import "./styles/studio.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
