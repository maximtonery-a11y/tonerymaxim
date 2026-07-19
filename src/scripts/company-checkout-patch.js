/* DOPLNKY DO src/scripts/checkout.js

1. Do tlačidla v pokladna.astro pridaj:
<button type="button" data-load-company>Načítať firmu</button>

2. Pod company-box pridaj:
<div class="company-status" data-company-status></div>

3. Do checkout.js vlož tieto funkcie pred fakeSubmit():
*/

function setValue(name, value) {
  const input = document.querySelector(`[name="${name}"]`);
  if (input && value) input.value = value;
}

async function loadCompanyByIco() {
  const icoInput = document.querySelector('[name="ico"]');
  const status = document.querySelector("[data-company-status]");
  const button = document.querySelector("[data-load-company]");
  const ico = String(icoInput?.value || "").replace(/\D/g, "");

  if (ico.length !== 8) {
    status.textContent = "Zadajte IČO v tvare 8 číslic.";
    status.className = "company-status is-error";
    return;
  }

  button.disabled = true;
  status.textContent = "Načítavam firmu z registra...";
  status.className = "company-status";

  try {
    const response = await fetch(`/novy/api/company?ico=${encodeURIComponent(ico)}`);
    const data = await response.json();

    if (!response.ok || !data.ok) throw new Error(data.error || "Firmu sa nepodarilo načítať.");

    const company = data.company || {};

    setValue("company", company.name);
    setValue("dic", company.dic);
    setValue("icdph", company.icDph);

    if (company.address) {
      setValue("address", company.address.street);
      setValue("city", company.address.city);
      setValue("zip", company.address.zip);
    }

    const preview = [
      company.name,
      company.legalForm ? `Právna forma: ${company.legalForm}` : "",
      company.nace ? `NACE: ${company.nace}` : "",
    ].filter(Boolean).join(" · ");

    status.textContent = preview || "Firma bola načítaná.";
    status.className = "company-status is-success";
  } catch (error) {
    status.textContent = error.message || "Nepodarilo sa načítať firmu.";
    status.className = "company-status is-error";
  } finally {
    button.disabled = false;
  }
}

/* 4. Do DOMContentLoaded pridaj:
document.querySelector("[data-load-company]")?.addEventListener("click", loadCompanyByIco);
*/
