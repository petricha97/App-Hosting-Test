/**
 * MessageLoading
 *
 * Animated three-dot SVG indicator shown inside a chat bubble while
 * waiting for the AI to respond. The three dots bounce up and down
 * in sequence using SVG animate elements — no CSS or JS required.
 *
 * Usage:
 *   <ChatBubbleMessage isLoading />   ← ChatBubbleMessage renders this automatically
 *   <MessageLoading />                ← or use it standalone
 */

export default function MessageLoading() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className="text-foreground"
    >
      {/* Left dot — starts first */}
      <circle cx="4" cy="12" r="2" fill="currentColor">
        <animate
          id="spinner_qFRN"
          begin="0;spinner_OcgL.end+0.25s"
          attributeName="cy"
          calcMode="spline"
          dur="0.6s"
          values="12;6;12"
          keySplines=".33,.66,.66,1;.33,0,.66,.33"
        />
      </circle>
      {/* Middle dot — starts 0.1s after the left dot */}
      <circle cx="12" cy="12" r="2" fill="currentColor">
        <animate
          begin="spinner_qFRN.begin+0.1s"
          attributeName="cy"
          calcMode="spline"
          dur="0.6s"
          values="12;6;12"
          keySplines=".33,.66,.66,1;.33,0,.66,.33"
        />
      </circle>
      {/* Right dot — starts 0.2s after the left dot, triggers the loop restart */}
      <circle cx="20" cy="12" r="2" fill="currentColor">
        <animate
          id="spinner_OcgL"
          begin="spinner_qFRN.begin+0.2s"
          attributeName="cy"
          calcMode="spline"
          dur="0.6s"
          values="12;6;12"
          keySplines=".33,.66,.66,1;.33,0,.66,.33"
        />
      </circle>
    </svg>
  );
}
