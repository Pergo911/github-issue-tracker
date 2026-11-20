import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Boot } from "@/app/boot.tsx";
import { publicConfigQuery } from "@/config/queries.ts";
import "@/ui/theme.css";

const queryClient = new QueryClient();

// The configuration request starts before React renders anything (SPEC 2.5).
void queryClient.prefetchQuery(publicConfigQuery);

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Boot />
    </QueryClientProvider>
  </StrictMode>,
);
