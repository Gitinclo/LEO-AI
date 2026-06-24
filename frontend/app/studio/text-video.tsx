import React from "react";
import { StudioScreen } from "@/src/StudioScreen";
import { TextVideoRenderer, parseSpec } from "@/src/Renderers";

export default function TextVideo() {
  return (
    <StudioScreen
      mode="text_video"
      modeCode="03"
      modeLabel="TEXT VIDEO"
      modeSub="Kinetic typography"
      placeholder="E.G. A POEM ABOUT WILDFIRES, RAW AND PUNCHY"
      renderOutput={(text) => {
        const spec = parseSpec(text) || { frames: [], background: "#111", color: "#fff" };
        return <TextVideoRenderer spec={spec as any} />;
      }}
    />
  );
}
