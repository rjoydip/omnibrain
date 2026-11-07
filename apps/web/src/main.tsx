import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotchToaster } from "notch-toast";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <NotchToaster position="bottom-center" mode="floating" animation="smooth" />
  </StrictMode>,
);
