import "@afcms/jotai-devframe/register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { DemoApp } from "../shared/app";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DemoApp embedded={process.env.NODE_ENV !== "production"} />
  </StrictMode>,
);
