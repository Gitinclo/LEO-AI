import React from "react";
import { StudioScreen } from "@/src/StudioScreen";
import { SvgArtRenderer } from "@/src/Renderers";

export default function SvgArt() {
  return (
    <StudioScreen
      mode="svg"
      modeCode="05"
      modeLabel="2D ART"
      modeSub="SVG synthesis"
      placeholder="E.G. ABSTRACT BAUHAUS POSTER, RED CIRCLES, BLACK GRID"
      renderOutput={(text) => <SvgArtRenderer svgText={text} />}
    />
  );
}
