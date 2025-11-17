// vim: set ts=4 sw=4:

import { WurmTermBackend } from "./WurmTermBackend.js";
import { Settings } from "./settings.js";
import { template, renderElement } from "./helpers/render.js";

// Change the current displayed document content into a WurmTerm runbook
//
// - make all <code> blocks editable
// - add play buttons
// - add result box when running commands

class Runbook {
    static #host;               // host selected for running commands
    static #timeout;            // connect timeout until we show a help on how to set up the backend agent
    static #timeoutFlag;        // true if timeout did trigger

    static #btnListener;
    static #statusListener;
    static #probeListener;
    static #runListener;

    static enable(view, host) {
        const selector = 'div.language-plaintext';  // match only showdown.js code blocks

        this.#host = host?host:'localhost';

        // make all <code> editable and add play button
        view.querySelectorAll(`${selector} pre`).forEach((el, i) => {
            el.contentEditable = true;
            el.parentElement.innerHTML = `
                <div class='play' data-nr='${i}'>
                    <button class='play'>▶</button>
                    ${el.parentElement.innerHTML}
                </div>`;
        });

        // Create connect bar
        view.insertAdjacentHTML('afterbegin', "<x-wurmterm-connect></x-wurmterm-connect>");

        document.addEventListener('WurmTermBackendRunResult', this.#runListener = (e) => {
            this.#runResult(view, e);
        });
            }

    // run commands from a <code> tag
    static run(e) {
        let el = e.target.parentElement;
        let cmd = e.target.parentElement.querySelector('code').innerText;

        if(!WurmTermBackend.isReady()) {
            alert("WurmTerm backend is not connected. Maybe the 'wurm' agent is not running? Start it with 'wurm start'.");
            return;
        }

        // Add output box
        let outputBox = el.querySelector('.output pre');
        if(outputBox)
            outputBox.innerText = "";
        else
            el.insertAdjacentHTML("beforeend", `
                <div class='output'>
                    <pre></pre>
                </div>
            `);
        
        WurmTermBackend.run(Runbook.#host, el.dataset.nr, cmd);
    }

    static #runResult(view, e) {
        let el = view.querySelector(`.play[data-nr="${e.detail.id}"] .output pre`);
        const escapeHTML = (str) => {
            const p = document.createElement("p");
            p.appendChild(document.createTextNode(str));
            return p.innerHTML;
        }
        el.innerHTML = escapeHTML(e.detail.stdout) + '\n<span style="color:red">' + escapeHTML(e.detail.stderr) + "</span>";
    }
}

export { Runbook };