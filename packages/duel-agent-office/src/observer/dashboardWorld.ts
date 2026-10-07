/**
 * The QA bullpen, from the Claude Design canvas "Agent Office screens" (World artboard): four desks seen
 * through the orthographic camera. Desk groups carry `data-desk` (the roster's desk number); the page sets `data-state` on each from
 * real events only, and CSS lights lamps and screens from it. Generated once from the artboard; edit by hand.
 */
export const WORLD_SVG = `<svg class="world-svg" id="world-svg" viewBox="-280 -120 620 440" shape-rendering="crispEdges" role="img" aria-label="The QA bullpen">
<g transform="matrix(-1 .5 0 1 0 0)">
<rect x="0" y="-96" width="256" height="96" fill="#7A5B40"></rect>
<rect x="0" y="-8" width="256" height="8" fill="#5A4130"></rect>
<rect x="40" y="-74" width="64" height="40" fill="#7A5236" stroke="#120C08" stroke-width="1"></rect>
<rect x="46" y="-68" width="16" height="20" fill="#EFE3C8"></rect>
<rect x="66" y="-70" width="14" height="16" fill="#EFE3C8"></rect>
<rect x="84" y="-66" width="14" height="22" fill="#EFE3C8"></rect>
<rect x="150" y="-70" width="36" height="70" fill="#5A3A20" stroke="#120C08" stroke-width="1"></rect>
<rect x="154" y="-66" width="28" height="28" fill="none" stroke="#3E2814" stroke-width="1"></rect>
<rect x="177" y="-36" width="3" height="3" fill="#E0A63F"></rect>
</g>
<g transform="matrix(1 .5 0 1 0 0)">
<rect x="0" y="-96" width="320" height="96" fill="#8F6D4D"></rect>
<rect x="0" y="-8" width="320" height="8" fill="#6B4E36"></rect>
<rect x="36" y="-80" width="52" height="40" fill="#2E2219"></rect>
<rect x="40" y="-76" width="44" height="32" fill="#E9B872"></rect>
<rect x="40" y="-56" width="44" height="12" fill="#C4896A"></rect>
<rect x="52" y="-62" width="14" height="6" fill="#B07258"></rect>
<rect x="61" y="-76" width="2" height="32" fill="#2E2219"></rect>
<rect x="232" y="-80" width="52" height="40" fill="#2E2219"></rect>
<rect x="236" y="-76" width="44" height="32" fill="#E9B872"></rect>
<rect x="236" y="-56" width="44" height="12" fill="#C4896A"></rect>
<rect x="262" y="-60" width="10" height="4" fill="#B07258"></rect>
<rect x="257" y="-76" width="2" height="32" fill="#2E2219"></rect>
</g>
<path d="M0 -96 V0" stroke="#120C08" stroke-width="1.5"></path>
<g transform="matrix(1 .5 -1 .5 0 0)">
<rect x="0" y="0" width="320" height="256" fill="#5E4532"></rect>
<path d="M0 32H320M0 64H320M0 96H320M0 128H320M0 160H320M0 192H320M0 224H320" stroke="#4A3526" stroke-width="1.5"></path>
<path d="M96 0V32M224 32V64M64 64V96M288 96V128M160 128V160M32 160V192M240 192V224M128 224V256" stroke="#4A3526" stroke-width="1.5"></path>
<rect x="116" y="104" width="88" height="52" fill="#6B3A2E"></rect>
<rect x="122" y="110" width="76" height="40" fill="none" stroke="#8C5A3E" stroke-width="2"></rect>
</g>
<g class="desk" data-desk="1">
<g stroke="#120C08" stroke-width="1">
<rect transform="matrix(1 .5 -1 .5 0 -22)" x="24" y="56" width="72" height="28" fill="#C08350"></rect>
<rect transform="matrix(1 .5 0 1 -84 42)" x="24" y="-22" width="72" height="22" fill="#A66D3B"></rect>
<rect transform="matrix(-1 .5 0 1 96 48)" x="56" y="-22" width="28" height="22" fill="#7E5029"></rect>
</g>
<rect transform="matrix(1 .5 0 1 -84 42)" x="30" y="-17" width="22" height="8" fill="none" stroke="#7E5029" stroke-width="1"></rect>
<ellipse class="glow" transform="matrix(1 .5 -1 .5 0 -22)" cx="80" cy="70" rx="20" ry="12" fill="#FFD27A" opacity=".32"></ellipse>
<g stroke="#120C08" stroke-width=".75">
<rect transform="matrix(1 .5 -1 .5 0 -44)" x="44" y="58" width="32" height="4" fill="#A9B3BC"></rect>
<rect transform="matrix(-1 .5 0 1 76 38)" x="58" y="-44" width="4" height="22" fill="#6E7882"></rect>
<rect transform="matrix(1 .5 0 1 -62 31)" x="44" y="-44" width="32" height="22" fill="#8E99A3"></rect>
<rect transform="matrix(1 .5 0 1 -65 32.5)" x="86" y="-38" width="3" height="16" fill="#6E7882"></rect>
<rect transform="matrix(1 .5 -1 .5 0 -42)" x="82" y="60" width="10" height="8" fill="#A9B3BC"></rect>
<rect transform="matrix(1 .5 0 1 -68 34)" x="82" y="-42" width="10" height="4" fill="#8E99A3"></rect>
<rect transform="matrix(-1 .5 0 1 92 46)" x="60" y="-42" width="8" height="4" fill="#6E7882"></rect>
</g>
<g transform="matrix(1 .5 0 1 -62 31)">
<rect x="46" y="-42" width="28" height="17" fill="#0F1A17"></rect>
<g class="screen">
<rect x="48" y="-40" width="12" height="1.5" fill="#4DBFB2"></rect>
<rect x="48" y="-37" width="20" height="1.5" fill="#D8F0DF"></rect>
<rect x="48" y="-34" width="16" height="1.5" fill="#D8F0DF"></rect>
<rect x="48" y="-31" width="9" height="1.5" fill="#92B0A1"></rect>
<rect x="48" y="-28" width="3" height="1.5" fill="#4DBFB2"></rect>
</g>
</g>
<g class="lamp" stroke="#120C08" stroke-width=".75">
<rect transform="matrix(1 .5 -1 .5 0 -42)" x="82" y="60" width="10" height="8" fill="#FFD27A"></rect>
<rect transform="matrix(1 .5 0 1 -68 34)" x="82" y="-42" width="10" height="4" fill="#E0A63F"></rect>
</g>
<g class="char" transform="translate(-38 79) scale(1.5) translate(-8 -24)">
<ellipse cx="8" cy="24" rx="7" ry="1.6" fill="#000" opacity=".35"></ellipse>
<g stroke="#120C08" stroke-width=".4">
<rect x="4" y="19" width="3" height="5" fill="#3B3540"></rect>
<rect x="9" y="19" width="3" height="5" fill="#3B3540"></rect>
<rect x="1" y="11" width="2" height="5" fill="#D9C7A8"></rect>
<rect x="13" y="11" width="2" height="5" fill="#D9C7A8"></rect>
<rect x="3" y="12" width="10" height="8" fill="#D9C7A8"></rect>
<rect x="3" y="18" width="10" height="1" fill="#2A1C12"></rect>
<rect x="4" y="6" width="8" height="6" fill="#4A2E1C"></rect>
<rect x="4" y="0" width="8" height="5" fill="#4A3020"></rect>
<rect x="4" y="3" width="8" height="1" fill="#E8735C"></rect>
<rect x="1" y="4" width="14" height="2" fill="#4A3020"></rect>
</g>
</g>
<path class="sel" fill="none" stroke="#FFF1C9" stroke-width="2" d="M-56 43V37H-50M-26 37H-20V43M-20 79V85H-26M-50 85H-56V79"></path>
</g>
<g stroke="#120C08" stroke-width="1">
<rect transform="matrix(1 .5 -1 .5 0 -60)" x="4" y="190" width="12" height="56" fill="#C08350"></rect>
<rect transform="matrix(1 .5 0 1 -246 123)" x="4" y="-60" width="12" height="60" fill="#A66D3B"></rect>
<rect transform="matrix(-1 .5 0 1 16 8)" x="190" y="-60" width="56" height="60" fill="#7E5029"></rect>
</g>
<g transform="matrix(-1 .5 0 1 16 8)">
<rect x="194" y="-56" width="48" height="16" fill="#3E2814"></rect>
<rect x="194" y="-36" width="48" height="16" fill="#3E2814"></rect>
<rect x="194" y="-16" width="48" height="14" fill="#3E2814"></rect>
<rect x="196" y="-54" width="5" height="14" fill="#6FA8F0"></rect>
<rect x="202" y="-52" width="4" height="12" fill="#EFE3C8"></rect>
<rect x="207" y="-55" width="6" height="15" fill="#9BC25A"></rect>
<rect x="216" y="-53" width="5" height="13" fill="#E8735C"></rect>
<rect x="198" y="-34" width="10" height="14" fill="#EFE3C8"></rect>
<rect x="212" y="-33" width="4" height="13" fill="#E0A63F"></rect>
<rect x="217" y="-35" width="5" height="15" fill="#E58AC0"></rect>
<rect x="226" y="-14" width="12" height="12" fill="#8E99A3"></rect>
</g>
<g class="desk" data-desk="3">
<g stroke="#120C08" stroke-width="1">
<rect transform="matrix(1 .5 -1 .5 0 -22)" x="24" y="168" width="72" height="28" fill="#C08350"></rect>
<rect transform="matrix(1 .5 0 1 -196 98)" x="24" y="-22" width="72" height="22" fill="#A66D3B"></rect>
<rect transform="matrix(-1 .5 0 1 96 48)" x="168" y="-22" width="28" height="22" fill="#7E5029"></rect>
</g>
<rect transform="matrix(1 .5 0 1 -196 98)" x="30" y="-17" width="22" height="8" fill="none" stroke="#7E5029" stroke-width="1"></rect>
<g class="papers" stroke="#120C08" stroke-width=".75">
<rect transform="matrix(1 .5 -1 .5 0 -26)" x="30" y="176" width="14" height="12" fill="#EFE3C8"></rect>
<rect transform="matrix(1 .5 0 1 -188 94)" x="30" y="-26" width="14" height="4" fill="#CDBE9F"></rect>
<rect transform="matrix(-1 .5 0 1 44 22)" x="176" y="-26" width="12" height="4" fill="#B5A585"></rect>
</g>
<ellipse class="glow" transform="matrix(1 .5 -1 .5 0 -22)" cx="80" cy="182" rx="20" ry="12" fill="#FFD27A" opacity=".32"></ellipse>
<g stroke="#120C08" stroke-width=".75">
<rect transform="matrix(1 .5 -1 .5 0 -44)" x="44" y="170" width="32" height="4" fill="#A9B3BC"></rect>
<rect transform="matrix(-1 .5 0 1 76 38)" x="170" y="-44" width="4" height="22" fill="#6E7882"></rect>
<rect transform="matrix(1 .5 0 1 -174 87)" x="44" y="-44" width="32" height="22" fill="#8E99A3"></rect>
<rect transform="matrix(1 .5 0 1 -177 88.5)" x="86" y="-38" width="3" height="16" fill="#6E7882"></rect>
<rect transform="matrix(1 .5 -1 .5 0 -42)" x="82" y="172" width="10" height="8" fill="#A9B3BC"></rect>
<rect transform="matrix(1 .5 0 1 -180 90)" x="82" y="-42" width="10" height="4" fill="#8E99A3"></rect>
<rect transform="matrix(-1 .5 0 1 92 46)" x="172" y="-42" width="8" height="4" fill="#6E7882"></rect>
</g>
<g transform="matrix(1 .5 0 1 -174 87)">
<rect x="46" y="-42" width="28" height="17" fill="#0F1A17"></rect>
<g class="screen">
<rect x="50" y="-41.5" width="7" height="1.5" fill="#F2E6CF"></rect>
<rect x="50" y="-40" width="20" height="13" fill="#F2E6CF"></rect>
<rect x="52" y="-38" width="16" height="8" fill="#3A4A55"></rect>
<rect x="54" y="-34" width="6" height="3" fill="#E0A63F"></rect>
</g>
</g>
<g class="lamp" stroke="#120C08" stroke-width=".75">
<rect transform="matrix(1 .5 -1 .5 0 -42)" x="82" y="172" width="10" height="8" fill="#FFD27A"></rect>
<rect transform="matrix(1 .5 0 1 -180 90)" x="82" y="-42" width="10" height="4" fill="#E0A63F"></rect>
</g>
<g class="char" transform="translate(-150 135) scale(1.5) translate(-8 -24)">
<ellipse cx="8" cy="24" rx="7" ry="1.6" fill="#000" opacity=".35"></ellipse>
<g stroke="#120C08" stroke-width=".4">
<rect x="4" y="19" width="3" height="5" fill="#3B3540"></rect>
<rect x="9" y="19" width="3" height="5" fill="#3B3540"></rect>
<rect x="1" y="12" width="2" height="6" fill="#5F7A86"></rect>
<rect x="13" y="12" width="2" height="6" fill="#5F7A86"></rect>
<rect x="3" y="12" width="10" height="8" fill="#5F7A86"></rect>
<rect x="5" y="12" width="6" height="7" fill="#EFE3C8"></rect>
<rect x="3" y="18" width="10" height="1" fill="#2A1C12"></rect>
<rect x="4" y="6" width="8" height="6" fill="#1E1A1A"></rect>
<rect x="4" y="0" width="8" height="5" fill="#3A2A20"></rect>
<rect x="4" y="3" width="8" height="1" fill="#6FA8F0"></rect>
<rect x="1" y="4" width="14" height="2" fill="#3A2A20"></rect>
</g>
</g>
<path class="sel" fill="none" stroke="#FFF1C9" stroke-width="2" d="M-168 99V93H-162M-138 93H-132V99M-132 135V141H-138M-162 141H-168V135"></path>
</g>
<g class="desk" data-desk="2">
<g stroke="#120C08" stroke-width="1">
<rect transform="matrix(1 .5 -1 .5 0 -22)" x="176" y="56" width="72" height="28" fill="#C08350"></rect>
<rect transform="matrix(1 .5 0 1 -84 42)" x="176" y="-22" width="72" height="22" fill="#A66D3B"></rect>
<rect transform="matrix(-1 .5 0 1 248 124)" x="56" y="-22" width="28" height="22" fill="#7E5029"></rect>
</g>
<rect transform="matrix(1 .5 0 1 -84 42)" x="182" y="-17" width="22" height="8" fill="none" stroke="#7E5029" stroke-width="1"></rect>
<ellipse class="glow" transform="matrix(1 .5 -1 .5 0 -22)" cx="232" cy="70" rx="20" ry="12" fill="#FFD27A" opacity=".32"></ellipse>
<g stroke="#120C08" stroke-width=".75">
<rect transform="matrix(1 .5 -1 .5 0 -44)" x="196" y="58" width="32" height="4" fill="#A9B3BC"></rect>
<rect transform="matrix(-1 .5 0 1 228 114)" x="58" y="-44" width="4" height="22" fill="#6E7882"></rect>
<rect transform="matrix(1 .5 0 1 -62 31)" x="196" y="-44" width="32" height="22" fill="#8E99A3"></rect>
<rect transform="matrix(1 .5 0 1 -65 32.5)" x="238" y="-38" width="3" height="16" fill="#6E7882"></rect>
<rect transform="matrix(1 .5 -1 .5 0 -42)" x="234" y="60" width="10" height="8" fill="#A9B3BC"></rect>
<rect transform="matrix(1 .5 0 1 -68 34)" x="234" y="-42" width="10" height="4" fill="#8E99A3"></rect>
<rect transform="matrix(-1 .5 0 1 244 122)" x="60" y="-42" width="8" height="4" fill="#6E7882"></rect>
</g>
<g transform="matrix(1 .5 0 1 -62 31)">
<rect x="198" y="-42" width="28" height="17" fill="#0F1A17"></rect>
<g class="screen">
<rect x="200" y="-40" width="12" height="1.5" fill="#4DBFB2"></rect>
<rect x="200" y="-37" width="20" height="1.5" fill="#D8F0DF"></rect>
<rect x="200" y="-34" width="16" height="1.5" fill="#D8F0DF"></rect>
<rect x="200" y="-31" width="9" height="1.5" fill="#92B0A1"></rect>
<rect x="200" y="-28" width="3" height="1.5" fill="#4DBFB2"></rect>
</g>
</g>
<g class="lamp" stroke="#120C08" stroke-width=".75">
<rect transform="matrix(1 .5 -1 .5 0 -42)" x="234" y="60" width="10" height="8" fill="#FFD27A"></rect>
<rect transform="matrix(1 .5 0 1 -68 34)" x="234" y="-42" width="10" height="4" fill="#E0A63F"></rect>
</g>
<g class="char" transform="translate(114 155) scale(1.5) translate(-8 -24)">
<ellipse cx="8" cy="24" rx="7" ry="1.6" fill="#000" opacity=".35"></ellipse>
<g stroke="#120C08" stroke-width=".4">
<rect x="4" y="19" width="3" height="5" fill="#4A4038"></rect>
<rect x="9" y="19" width="3" height="5" fill="#4A4038"></rect>
<rect x="1" y="12" width="2" height="6" fill="#8C6E52"></rect>
<rect x="13" y="12" width="2" height="6" fill="#8C6E52"></rect>
<rect x="3" y="12" width="10" height="8" fill="#8C6E52"></rect>
<rect x="6" y="13" width="4" height="5" fill="#6B5240"></rect>
<rect x="3" y="18" width="10" height="1" fill="#2A1C12"></rect>
<rect x="4" y="6" width="8" height="6" fill="#B07A3E"></rect>
<rect x="4" y="0" width="8" height="5" fill="#C9B08A"></rect>
<rect x="4" y="3" width="8" height="1" fill="#9BC25A"></rect>
<rect x="0" y="4" width="16" height="2" fill="#C9B08A"></rect>
</g>
</g>
<path class="sel" fill="none" stroke="#FFF1C9" stroke-width="2" d="M96 119V113H102M126 113H132V119M132 155V161H126M102 161H96V155"></path>
</g>
<g stroke="#120C08" stroke-width="1">
<rect transform="matrix(1 .5 -1 .5 0 -44)" x="280" y="10" width="26" height="20" fill="#A9B3BC"></rect>
<rect transform="matrix(1 .5 0 1 -30 15)" x="280" y="-44" width="26" height="44" fill="#8E99A3"></rect>
<rect transform="matrix(-1 .5 0 1 306 153)" x="10" y="-44" width="20" height="44" fill="#6E7882"></rect>
</g>
<g transform="matrix(1 .5 0 1 -30 15)" fill="none" stroke="#5E6872" stroke-width="1">
<rect x="283" y="-40" width="20" height="12"></rect>
<rect x="283" y="-26" width="20" height="12"></rect>
<rect x="290" y="-36" width="6" height="2" fill="#3E464E"></rect>
<rect x="290" y="-22" width="6" height="2" fill="#3E464E"></rect>
</g>
<g class="desk" data-desk="4">
<g stroke="#120C08" stroke-width="1">
<rect transform="matrix(1 .5 -1 .5 0 -22)" x="176" y="168" width="72" height="28" fill="#C08350"></rect>
<rect transform="matrix(1 .5 0 1 -196 98)" x="176" y="-22" width="72" height="22" fill="#A66D3B"></rect>
<rect transform="matrix(-1 .5 0 1 248 124)" x="168" y="-22" width="28" height="22" fill="#7E5029"></rect>
</g>
<rect transform="matrix(1 .5 0 1 -196 98)" x="182" y="-17" width="22" height="8" fill="none" stroke="#7E5029" stroke-width="1"></rect>
<ellipse class="glow" transform="matrix(1 .5 -1 .5 0 -22)" cx="232" cy="182" rx="20" ry="12" fill="#FFD27A" opacity=".32"></ellipse>
<g stroke="#120C08" stroke-width=".75">
<rect transform="matrix(1 .5 -1 .5 0 -44)" x="196" y="170" width="32" height="4" fill="#A9B3BC"></rect>
<rect transform="matrix(-1 .5 0 1 228 114)" x="170" y="-44" width="4" height="22" fill="#6E7882"></rect>
<rect transform="matrix(1 .5 0 1 -174 87)" x="196" y="-44" width="32" height="22" fill="#8E99A3"></rect>
<rect transform="matrix(1 .5 0 1 -174 87)" x="198" y="-42" width="28" height="17" fill="#0F1A17"></rect>
<rect transform="matrix(1 .5 0 1 -177 88.5)" x="238" y="-38" width="3" height="16" fill="#6E7882"></rect>
<rect transform="matrix(1 .5 -1 .5 0 -42)" x="234" y="172" width="10" height="8" fill="#A9B3BC"></rect>
<rect transform="matrix(1 .5 0 1 -180 90)" x="234" y="-42" width="10" height="4" fill="#8E99A3"></rect>
<rect transform="matrix(-1 .5 0 1 244 122)" x="172" y="-42" width="8" height="4" fill="#6E7882"></rect>
</g>
<g class="screen" transform="matrix(1 .5 0 1 -174 87)">
<rect x="200" y="-40" width="12" height="1.5" fill="#4DBFB2"></rect>
<rect x="200" y="-37" width="20" height="1.5" fill="#D8F0DF"></rect>
<rect x="200" y="-34" width="16" height="1.5" fill="#D8F0DF"></rect>
<rect x="200" y="-31" width="9" height="1.5" fill="#92B0A1"></rect>
<rect x="200" y="-28" width="3" height="1.5" fill="#4DBFB2"></rect>
</g>
<g class="lamp" stroke="#120C08" stroke-width=".75">
<rect transform="matrix(1 .5 -1 .5 0 -42)" x="234" y="172" width="10" height="8" fill="#FFD27A"></rect>
<rect transform="matrix(1 .5 0 1 -180 90)" x="234" y="-42" width="10" height="4" fill="#E0A63F"></rect>
</g>
<g class="char" transform="translate(2 211) scale(1.5) translate(-8 -24)">
<ellipse cx="8" cy="24" rx="7" ry="1.6" fill="#000" opacity=".35"></ellipse>
<g stroke="#120C08" stroke-width=".4">
<rect x="4" y="19" width="3" height="5" fill="#3B3540"></rect>
<rect x="9" y="19" width="3" height="5" fill="#3B3540"></rect>
<rect x="2" y="13" width="2" height="5" fill="#A88C6E"></rect>
<rect x="12" y="13" width="2" height="5" fill="#A88C6E"></rect>
<rect x="3" y="12" width="10" height="8" fill="#A88C6E"></rect>
<rect x="3" y="18" width="10" height="1" fill="#2A1C12"></rect>
<rect x="4" y="6" width="8" height="6" fill="#7A4A3A"></rect>
<rect x="4" y="0" width="8" height="5" fill="#2A2A30"></rect>
<rect x="4" y="3" width="8" height="1" fill="#E58AC0"></rect>
<rect x="1" y="4" width="14" height="2" fill="#2A2A30"></rect>
</g>
</g>
<path class="sel" fill="none" stroke="#FFF1C9" stroke-width="2" d="M-16 175V169H-10M14 169H20V175M20 211V217H14M-10 217H-16V211"></path>
</g>
</svg>`;
