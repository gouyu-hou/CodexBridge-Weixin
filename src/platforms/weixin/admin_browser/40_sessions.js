
    function renderSessionFilters(accounts) {
      const select = $('session-account');
      const selected = select.value;
      select.textContent = '';
      const all = document.createElement('option');
      all.value = '';
      all.textContent = '全部账号';
      select.appendChild(all);
      for (const account of accounts) {
        const option = document.createElement('option');
        option.value = account.accountId;
        option.textContent = (account.displayName || account.accountId) + (account.primary ? '（主账号）' : '');
        select.appendChild(option);
      }
      select.value = selected;
    }

    async function loadSessions() {
      const params = new URLSearchParams();
      const query = $('session-query').value.trim();
      const accountId = $('session-account').value.trim();
      const sort = $('session-sort').value;
      if (query) params.set('query', query);
      if (accountId) params.set('accountId', accountId);
      if (sort) params.set('sort', sort);
      const data = await requestJson('/api/sessions?' + params.toString());
      renderSessions(data.sessions || [], data.total || 0, data.returned || 0);
    }

    function renderSessions(sessions, total, returned) {
      const body = $('sessions-body');
      body.textContent = '';
      $('session-count').textContent = total ? ('显示 ' + returned + ' / ' + total + ' 个') : '暂无会话';
      if (!sessions.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.className = 'muted';
        td.textContent = '没有找到匹配的会话';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const session of sessions) {
        const tr = document.createElement('tr');
        tr.appendChild(sessionTitleCell(session));
        tr.appendChild(textCell('微信账号', formatSessionAccounts(session)));
        tr.appendChild(textCell('模型', formatSessionModel(session)));
        tr.appendChild(textCell('更新时间', fmtTime(session.updatedAt) || '-'));
        tr.appendChild(sessionStatusCell(session));
        tr.appendChild(sessionActionsCell(session));
        body.appendChild(tr);
      }
    }

    function sessionTitleCell(session) {
      const td = document.createElement('td');
      td.dataset.label = '标题 / 最新问题';
      const title = document.createElement('div');
      title.className = 'session-title';
      title.textContent = session.title || session.codexThreadId || '(无标题)';
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = '线程：' + (session.codexThreadId || '-') + '  项目：' + (session.cwd || '-');
      td.appendChild(title);
      if (session.preview) {
        const preview = document.createElement('div');
        preview.className = 'session-preview';
        preview.textContent = '最新问题：' + session.preview;
        td.appendChild(preview);
      }
      td.appendChild(meta);
      return td;
    }

    function sessionStatusCell(session) {
      const td = document.createElement('td');
      td.dataset.label = '状态';
      const wrap = document.createElement('div');
      wrap.className = 'actions';
      if (session.pinned) {
        const pinned = document.createElement('span');
        pinned.className = 'pill ok';
        pinned.textContent = '置顶';
        wrap.appendChild(pinned);
      }
      if (session.archived) {
        const archived = document.createElement('span');
        archived.className = 'pill warn';
        archived.textContent = '归档';
        wrap.appendChild(archived);
      }
      if (!session.pinned && !session.archived) {
        const normal = document.createElement('span');
        normal.className = 'pill';
        normal.textContent = '正常';
        wrap.appendChild(normal);
      }
      td.appendChild(wrap);
      return td;
    }

    function sessionActionsCell(session) {
      const td = document.createElement('td');
      td.dataset.label = '操作';
      const wrap = document.createElement('div');
      wrap.className = 'actions';

      const history = document.createElement('button');
      history.textContent = '查看历史';
      history.onclick = () => openSessionHistory(session)
        .catch((error) => setMessage(error.message, true));

      const archive = document.createElement('button');
      archive.textContent = session.archived ? '恢复' : '归档';
      archive.onclick = () => setSessionArchived(session, !session.archived)
        .catch((error) => setMessage(error.message, true));

      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '删除';
      del.onclick = () => deleteSession(session)
        .catch((error) => setMessage(error.message, true));

      wrap.appendChild(history);
      wrap.appendChild(archive);
      wrap.appendChild(del);
      td.appendChild(wrap);
      return td;
    }

    async function setSessionArchived(session, archived) {
      const name = session.title || session.codexThreadId || session.id;
      await requestJson('/api/sessions/' + encodeURIComponent(session.id), {
        method: 'PATCH',
        body: JSON.stringify({ archived })
      });
      setMessage((archived ? '已归档：' : '已恢复：') + name, false);
      await loadSessions();
    }

    async function deleteSession(session) {
      const name = session.title || session.codexThreadId || session.id;
      const lineBreak = String.fromCharCode(10);
      const prompt = [
        '确定删除这个本地会话记录吗？',
        name,
        '',
        '不会删除 Codex 原始历史文件。'
      ].join(lineBreak);
      if (!confirm(prompt)) {
        return;
      }
      await requestJson('/api/sessions/' + encodeURIComponent(session.id), { method: 'DELETE' });
      setMessage('已删除本地会话记录：' + name, false);
      await loadSessions();
    }

    let historySessionId = null;

    async function openSessionHistory(session) {
      historySessionId = session.id;
      $('history-title').textContent = '会话历史 · ' + (session.title || session.codexThreadId || session.id);
      $('history-search').value = '';
      $('history-count').textContent = '';
      $('history-body').textContent = '正在加载历史...';
      $('history-modal').hidden = false;
      await loadSessionHistory('');
    }

    async function loadSessionHistory(query) {
      if (!historySessionId) return;
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      const url = '/api/sessions/' + encodeURIComponent(historySessionId) + '/history'
        + (params.toString() ? ('?' + params.toString()) : '');
      const data = await requestJson(url);
      renderHistory(data);
    }

    function renderHistory(data) {
      const body = $('history-body');
      body.textContent = '';
      const messages = (data && data.messages) || [];
      const total = data && data.total ? data.total : 0;
      $('history-count').textContent = total
        ? ('显示 ' + messages.length + ' / ' + total + ' 条' + (data.truncated ? '（仅最近）' : ''))
        : '';
      if (!data || !data.sessionPath) {
        body.textContent = '没有找到这条会话的 Codex 历史文件。';
        return;
      }
      if (!messages.length) {
        body.textContent = '没有匹配的历史消息。';
        return;
      }
      for (const message of messages) {
        const card = document.createElement('div');
        card.className = 'history-msg ' + (message.role === 'user' ? 'user' : 'assistant');
        const meta = document.createElement('div');
        meta.className = 'history-meta';
        const role = document.createElement('span');
        role.className = 'history-role';
        role.textContent = message.role === 'user' ? '用户' : '助手';
        meta.appendChild(role);
        const time = document.createElement('span');
        time.textContent = fmtTime(message.timestamp) || '';
        meta.appendChild(time);
        const text = document.createElement('div');
        text.className = 'history-text';
        text.textContent = message.text || '';
        card.appendChild(meta);
        card.appendChild(text);
        body.appendChild(card);
      }
    }

    function closeSessionHistory() {
      historySessionId = null;
      $('history-modal').hidden = true;
    }
