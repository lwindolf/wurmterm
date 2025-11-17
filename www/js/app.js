// vim: set ts=4 sw=4:
/* jshint esversion: 6 */

//import { setupNotebook } from './notebook.js';
import { WurmTermSettingsView } from './WurmTermSettingsView.js';
import { perfRenderer } from './renderer/perf-flamegraph.js';
import { netmapRenderer } from './renderer/netmap.js';

const params = new URLSearchParams(window.location.search);
const renderers = {
        'netmap': netmapRenderer,
        'perfFlameGraph': perfRenderer
};
var extraHosts = [];    // list of hosts manually added

function multiMatch(text, severities) {
        var matchResult;
        ['critical','warning'].forEach(function(name) {
                if(severities[name] === undefined)
                        return;

                var re = new RegExp(severities[name]);
                var matches = re.exec(text);
                if(matches !== null) {
                        matchResult = name;
                        return;
                }
        });
        return matchResult;
}

// Note: mutates d.probeSeverity
function markSeverity(s, d) {
                if(d.render === undefined || d.render.severity === undefined)
                        return s;

                switch(multiMatch(s, d.render.severity)) {
                        case 'critical':
                                d.probeSeverity = 'critical';
                                return "<span class='severity_critical'>"+s+"</span>";
                        case 'warning':
                                if(d.probeSeverity === undefined)
                                        d.probeSeverity = 'warning';
                                return "<span class='severity_warning'>"+s+"</span>";
                        default:
                                return s;
                }
}

function renderString(d) {
        var res = [];
        JSON.parse(JSON.stringify(d.stdout)).split(/\n/).forEach(function(line) {
                res.push(markSeverity(line.replace(/\"/g, ""), d));
        });
        return res.join('<br/>');
}

function renderTable(d) {
        var res = "<table>";
        var re = new RegExp(d.render.split);
        d.stdout.split(/\n/).forEach(function(line) {
                res += "<tr>";
                line.split(re).forEach(function(column) {
                        res += "<td>"+markSeverity(column, d)+"</td>";
                });
                res += "</tr>";
        });
        return res + "</table>";
}

function triggerProbe(host, name) {
        ProbeAPI.probe(host, name, probeResultCb, probeErrorCb);
}

function probeErrorCb(e, probe, h) {
        var hId = strToId(h);
        var id = "box_"+hId+"_"+probe.replace(/[. ]/g, "_");
        addProbe(h, id, probe, probe);
        var box = document.getElementById(id);
        if (box) {
                var errEl = box.querySelector('.error');
                if (errEl) errEl.textContent = e;
        }
        console.error(`probe Error: host=${h} probe=${probe} ${e}`);
}

function strToId(h) {
        return h.replace(/[^a-zA-Z0-9]/g, '');
}

function resortBoxes(list) {
        var children = Array.from(list.children);
        children
                .sort(function (a,b) {
                        var ac = 0, bc = 0;
                        if (a.getAttribute('collapsed') !== "1")
                                ac += 40;
                        if (b.getAttribute('collapsed') !== "1")
                                bc += 40;
                        if (a.classList.contains('severity_critical'))
                                ac += 20;
                        if (a.classList.contains('severity_warning'))
                                ac += 10;
                        if (b.classList.contains('severity_critical'))
                                bc += 20;
                        if (b.classList.contains('severity_warning'))
                                bc += 10;

                        if (a.innerText<b.innerText)
                                ac += 1;
                        else
                                bc += 1;

                        return (ac<bc?1:-1);
                })
                .forEach(node=>list.appendChild(node));
}

function visualizeHost(host, renderer) {
        var visualContainer = document.getElementById('visualContainer');
        if (visualContainer) visualContainer.style.display = '';
        var visHost = document.getElementById('visualizedHost');
        if (visHost) visHost.innerHTML = host;
        var rendererEl = document.getElementById('renderer');
        if (rendererEl) rendererEl.value = renderer;
        var visual = document.getElementById('visual');
        if (visual) {
                visual.innerHTML = '';
                visual.style.height = '600px';
        }
        try {
                renderers[renderer](ProbeAPI, '#visual', host);
        } catch(e) {
                if (visual) visual.innerHTML = 'ERROR: Rendering failed!';
                console.error(`render Error: host=${host} ${e}`);
        }
}

function addHost(h) {
        ProbeAPI.start(h, probeResultCb, probeErrorCb);

        var hId = strToId(h);
        if(!document.getElementById(hId)) {
                var nodes = document.getElementById('nodes');
                if (nodes) nodes.insertAdjacentHTML('beforeend', `<div id="${hId}" class='node' data-host='${h}'>
                                <div class='name'></div>
                                <div class='boxes'></div>
                </div>`);
        }
        var nameEl = document.querySelector(`#${hId}.node .name`);
        if (nameEl) nameEl.textContent = h;
        var nodeEl = document.querySelector(`#${hId}.node`);
        if (nodeEl) nodeEl.classList.remove('disconnected');

        if (nameEl) {
                nameEl.addEventListener('click', function() {
                        var parent = this.parentElement;
                        var host = parent && parent.dataset ? parent.dataset.host : undefined;
                        visualizeHost(host, 'netmap');
                });
        }
}

function addProbe(h, id, probe, title) {
        var hId = strToId(h);
        if(!document.getElementById(id)) {
                var boxesEl = document.querySelector(`#${hId} .boxes`);
                if (boxesEl) boxesEl.insertAdjacentHTML('beforeend', `
                        <div class='box collapsed' collapsed='1' autocollapse='1' forcecollapse='0' id='${id}'>
                                <div class='head clearfix'>
                                        <div class='title'><span class='emoji'></span>${title}</div>
                                        <div class='reload' title='Reload probe'>
                                                <a href='javascript:triggerProbe("${h}","${probe}")'>&#10227;</a>
                                        </div>
                                </div>
                                <div class='error'></div>
                                <div class='content'></div>
                        </div>`);
        }

}

function probeResultCb(probe, h, d) {
        var hId = strToId(h);
        var id = "box_"+hId+"_"+strToId(d.probe);
        var tmp = "";
        addProbe(h, id, probe, d.probe);
        if('render' in d) {
                if(d.render.type === 'table') {
                        tmp += renderTable(d);
                } else if(d.render.type === 'lines') {
                        tmp += renderString(d);
                } else {
                        tmp += "<div class='error'>Fatal: unknown renderer type "+(d.render && d.render.type)+"</div>";
                        d.probeSeverity = 'invalid';
                }
        } else {
                tmp = renderString(d);
        }

        var box = document.getElementById(id);
        if (!box) return;

        if(d.probeSeverity === undefined) {
                box.classList.remove('severity_warning');
                box.classList.remove('severity_critical');
                box.classList.add('ok');
                box.classList.add('collapsed');
                box.classList.remove('uncollapsed');
                box.setAttribute('collapsed', box.getAttribute('autocollapse'));
        } else {
                box.classList.remove('ok');
                box.classList.add('severity_'+ d.probeSeverity);
                box.classList.add('uncollapsed');
                box.classList.remove('collapsed');
                box.setAttribute('collapsed', box.getAttribute('forcecollapse'));
        }

        var contentEl = box.querySelector('.content');
        if(d.stdout === "") {
                box.classList.add('empty');
                if (contentEl) contentEl.innerHTML = 'Probe result empty!';
        } else {
                box.classList.remove('empty');
                if (contentEl) contentEl.innerHTML = tmp;
        }

        // Auto-collapse rendering
        if (box.getAttribute('collapsed') === '1') {
                if (contentEl) contentEl.style.display = 'none';
        } else {
                if (contentEl) contentEl.style.display = '';
        }

        // Replace click handlers on all titles
        var titleEls = document.querySelectorAll('.box .head .title');
        titleEls.forEach(function(titleEl) {
                titleEl.onclick = function() {
                        var boxEl = this.parentElement && this.parentElement.parentElement;
                        if (!boxEl) return;

                        if(boxEl.getAttribute('collapsed') === '1') {
                                boxEl.setAttribute('collapsed', 0);
                                boxEl.setAttribute('autocollapse', 0);
                                boxEl.setAttribute('forcecollapse', 0);
                                boxEl.classList.add('uncollapsed');
                                boxEl.classList.remove('collapsed');
                                var c = boxEl.querySelector('.content');
                                if (c) c.style.display = '';
                        } else {
                                boxEl.setAttribute('collapsed', 1);
                                boxEl.setAttribute('autocollapse', 1);
                                boxEl.setAttribute('forcecollapse', 1);
                                boxEl.classList.add('collapsed');
                                boxEl.classList.remove('uncollapsed');
                                var c = boxEl.querySelector('.content');
                                if (c) c.style.display = 'none';
                        }

                        resortBoxes(boxEl.parentElement);
                };
        });
        var boxesContainer = document.querySelector(`#${hId} .boxes`);
        if (boxesContainer) resortBoxes(boxesContainer);
}

function updateHosts(d) {
        // Stop disconnected hosts
        document.querySelectorAll('.node:not(.disconnected)').forEach(function(n) {
                var h = n.dataset.host;
                if(!d.includes(h) && !extraHosts.includes(h) && (h !== 'localhost')) {
                        console.log('stopping '+h);
                        ProbeAPI.stop(h);
                        n.classList.add('disconnected');
                }
        });
        // Start newly connected hosts
        d.forEach(function(h) {
                var hId = strToId(h);
                if(!document.getElementById(hId)) {
                        addHost(h);
                }
        });
}

function addHistory(d) {
        var history = document.getElementById('history');
        if (history) history.innerHTML = '';
        var notebookHosts = document.getElementById('notebook-hosts');
        d.forEach(function(h) {
                if (history) history.insertAdjacentHTML('beforeend', `<li>${h}</li>`);
                if (notebookHosts) notebookHosts.insertAdjacentHTML('beforeend', `<option value='${h}'>`);
        });
        if (history) {
                history.addEventListener('click', function(e) {
                        var target = e.target;
                        if(target && target.tagName === 'LI') {
                                var h = target.textContent;
                                console.log(`manually started ${h}`);
                                extraHosts.push(h);
                                addHost(h);
                        }
                });
        }

        var hostForm = document.getElementById('hostForm');
        if (hostForm) {
                hostForm.addEventListener('submit', function(event) {
                        var entry = document.getElementById('hostEntry');
                        var h = entry ? entry.value : '';
                        if(h === "")
                                return;
                        console.log(`manually started ${h}`);
                        extraHosts.push(h);
                        addHost(h);
                        event.preventDefault();
                        return true;
                });
        }        
}

var clearInfoTimeout;
function setInfo(str, timeout = 5000) {
        var info = document.getElementById('info');
        if (info) {
                info.style.display = '';
                info.innerHTML = str;
        }

        if(clearInfoTimeout)
                clearTimeout(clearInfoTimeout);
        clearInfoTimeout = setTimeout(function() {
                if (info) info.style.display = 'none';
        }, timeout);
}

function view(id) {
        console.log(`view: ${id}`);     
        document.querySelectorAll('.main').forEach(function(el){ el.style.display = 'none'; });
        document.getElementById(id).style.display = 'block';

        if('settings' === id)
                new WurmTermSettingsView('settings');
}

function setupApp() {
        if('serviceWorker' in navigator)
                navigator.serviceWorker.register('./worker.js');

        if (navigator.storage && navigator.storage.persist)
                navigator.storage.persist();             
                
        document.querySelectorAll('#menu a').forEach(function(a){
                a.addEventListener('click', function() {
                        view(a.getAttribute('data-view'));
                });
        });

        view(params.get('view')?params.get('view'):'main');
        /*setupNotebook(
                params.get('host'),
                params.get('notebook')
        );*/

        var rendererEl = document.getElementById('renderer');
        if (rendererEl) {
                rendererEl.addEventListener('change', function() {
                        var visHost = document.getElementById('visualizedHost');
                        var hostText = visHost ? visHost.textContent : '';
                        visualizeHost(hostText, this.value);
                });
        }
}

export { setupApp, updateHosts, addHistory, setInfo, view };
