const instructionBtn = document.getElementById("instructionBtn");
const instructionModal = document.getElementById("instructionModal");
const instructionCloseBtn = document.getElementById("instructionCloseBtn");

instructionBtn.addEventListener("click", () => {
  instructionModal.classList.remove("hidden");
});

instructionCloseBtn.addEventListener("click", () => {
  instructionModal.classList.add("hidden");
});
