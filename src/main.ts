import "./styles/main.css";
import "./styles/art.css";
import { initI18n } from "./ui/i18n";
import { initSimulator } from "./sim/simulator";
import { initBento } from "./ui/bento";
import { initModal } from "./ui/modal";
import { initTour } from "./ui/tour";
import { initCountUp, initReveal, initSpotlight } from "./ui/motion";

const bus = new EventTarget();

initI18n();
const sim = document.getElementById("sim");
if (sim) initSimulator(sim, bus);
initBento(bus);
initModal();
initTour();
initReveal();
initCountUp();
initSpotlight(document.querySelector(".bento"), ".cell");
initSpotlight(document.querySelector(".plans"), ".plan");

// Translucent nav gets its edge only once content scrolls under it.
const nav = document.getElementById("nav");
if (nav) {
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}
