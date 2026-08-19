/* Public MD-call booking: pick a weekday, pick an open 1-hour slot, book. */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    var chosenHour = null;

    var dateInput = $('cbDate'), grid = $('slotGrid'), hint = $('slotHint'),
        submit = $('cbSubmit'), status = $('cbStatus'), form = $('callForm');

    // Weekdays only, today through +30 days.
    var now = new Date();
    var localISO = function (d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
    dateInput.min = localISO(now);
    dateInput.max = localISO(new Date(now.getTime() + 30 * 86400000));

    function updateSubmit() {
        submit.disabled = !(dateInput.value && chosenHour !== null);
        status.textContent = submit.disabled ? 'Select a date and time to book.'
            : 'Booking ' + dateInput.value + ' at ' + labelFor(chosenHour) + '.';
    }
    function labelFor(hour) {
        var h = hour > 12 ? hour - 12 : hour;
        return h + ':00 ' + (hour >= 12 ? 'PM' : 'AM') + ' MT';
    }

    function loadSlots() {
        chosenHour = null;
        grid.textContent = '';
        updateSubmit();
        if (!dateInput.value) { hint.textContent = 'Choose a date to see open slots.'; return; }
        hint.textContent = 'Checking availability…';
        fetch('/api/call-slots?date=' + encodeURIComponent(dateInput.value))
            .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Unavailable'); return d; }); })
            .then(function (d) {
                grid.textContent = '';
                var open = 0;
                d.slots.forEach(function (s) {
                    var b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'slot-btn';
                    b.textContent = s.label;
                    b.disabled = !!s.taken;
                    if (!s.taken) open++;
                    b.addEventListener('click', function () {
                        chosenHour = s.hour;
                        Array.prototype.forEach.call(grid.children, function (c) { c.classList.remove('active'); });
                        b.classList.add('active');
                        updateSubmit();
                    });
                    grid.appendChild(b);
                });
                hint.textContent = open ? open + ' open slots — all times Mountain Time.' : 'That day is fully booked — try another date.';
            })
            .catch(function (e) { hint.textContent = e && e.message ? e.message : 'Could not load slots — try another date.'; });
    }
    dateInput.addEventListener('change', loadSlots);

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (submit.disabled) return;
        submit.disabled = true;
        status.textContent = 'Booking…';
        fetch('/api/call-book', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                date: dateInput.value, hour: chosenHour,
                name: $('cbName').value.trim(), clinic: $('cbClinic').value.trim(),
                email: $('cbEmail').value.trim(), phone: $('cbPhone').value.trim(),
                notes: $('cbNotes').value.trim(), website: $('cbHp').value
            })
        }).then(function (r) {
            return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Booking failed'); return d; });
        }).then(function (d) {
            form.hidden = true;
            var ok = document.createElement('div');
            ok.className = 'call-ok';
            ok.textContent = 'Booked: ' + d.date + ' at ' + (d.label || labelFor(chosenHour)) +
                '. A CelluNOVA physician will call you — check your email for anything we need beforehand.';
            form.parentNode.appendChild(ok);
        }).catch(function (e) {
            status.textContent = e && e.message ? e.message : 'Booking failed — try again.';
            submit.disabled = false;
            if (String(e && e.message).indexOf('taken') !== -1) loadSlots();
        });
    });
})();
