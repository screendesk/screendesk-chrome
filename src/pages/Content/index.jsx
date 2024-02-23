import React from "react";
import { render } from "react-dom";
import Content from "./Content";

// Check if screendesk-ui already exists, if so, remove it
const existingRoot = document.getElementById("screendesk-ui");
if (existingRoot) {
  document.body.removeChild(existingRoot);
}

const root = document.createElement("div");
root.id = "screendesk-ui";
document.body.appendChild(root);
render(<Content />, root);
