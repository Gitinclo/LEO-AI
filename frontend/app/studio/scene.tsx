import React from "react";
import { StudioScreen } from "@/src/StudioScreen";
import { SceneRenderer, parseSpec } from "@/src/Renderers";

export default function Scene() {
  return (
    <StudioScreen
      mode="scene"
      modeCode="01"
      modeLabel="3D SCENE"
      modeSub="Generative geometry"
      placeholder="E.G. FLOATING ICE CRYSTALS ABOVE A CRIMSON OCEAN"
      renderOutput={(text) => {
        const spec = parseSpec(text) || { objects: [] };
        return <SceneRenderer spec={spec as any} />;
      }}
    />
  );
}
