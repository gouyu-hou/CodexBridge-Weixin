
    function renderAccounts(accounts) {
      const body = $('accounts-body');
      body.textContent = '';
      if (!accounts.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.className = 'muted';
        td.textContent = '暂无账号';
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const account of accounts) {
        const tr = document.createElement('tr');
        tr.appendChild(nameCell(account));
        tr.appendChild(accountIdCell(account));
        tr.appendChild(accountConfigCell(account));
        tr.appendChild(statusCell(account));
        tr.appendChild(actionCell(account));
        body.appendChild(tr);
      }
    }

    function nameCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '名称';
      const wrap = document.createElement('div');
      wrap.className = 'name-cell';
      const row = document.createElement('div');
      row.className = 'rename-row';
      const input = document.createElement('input');
      input.value = account.displayName || '';
      input.placeholder = account.primary ? '我的账号' : '朋友备注';
      const save = document.createElement('button');
      save.textContent = '保存';
      save.onclick = async () => {
        await patchAccount(account.accountId, { displayName: input.value });
      };
      row.appendChild(input);
      row.appendChild(save);
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = '添加：' + (fmtTime(account.savedAt) || '-') + '  同步：' + (fmtTime(account.syncUpdatedAt) || '-');
      wrap.appendChild(row);
      wrap.appendChild(meta);
      td.appendChild(wrap);
      return td;
    }

    function accountIdCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '账号';
      const wrap = document.createElement('div');
      wrap.className = 'account-id';
      const main = document.createElement('div');
      main.className = 'account-id-main';
      main.textContent = account.accountId || '-';
      wrap.appendChild(main);
      const sub = document.createElement('div');
      sub.className = 'account-id-sub';
      sub.textContent = account.primary ? '主账号' : '朋友入口';
      wrap.appendChild(sub);
      td.appendChild(wrap);
      return td;
    }

    function textCell(label, text) {
      const td = document.createElement('td');
      td.dataset.label = label;
      td.textContent = text || '-';
      return td;
    }

    function accountConfigCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '用户 / 权限';
      const wrap = document.createElement('div');
      wrap.className = 'account-config';
      const savedTriple = {
        providerProfileId: (account.modelProvider && account.modelProvider.providerProfileId) || '',
        model: (account.modelProvider && account.modelProvider.model) || '',
        reasoningEffort: (account.modelProvider && account.modelProvider.reasoningEffort) || '',
      };
      const user = document.createElement('div');
      user.className = 'muted';
      user.textContent = '用户：' + (account.userId || '-');
      wrap.appendChild(user);

      const groupRole = document.createElement('div');
      groupRole.className = 'account-config-row';
      const group = document.createElement('input');
      group.value = account.group || '';
      group.placeholder = '分组，例如：朋友';
      const role = document.createElement('select');
      for (const item of [
        ['owner', '主账号'],
        ['admin', '管理员'],
        ['member', '普通用户'],
        ['viewer', '只读用户'],
      ]) {
        const option = document.createElement('option');
        option.value = item[0];
        option.textContent = item[1];
        role.appendChild(option);
      }
      role.value = account.role || (account.primary ? 'owner' : 'member');
      role.disabled = Boolean(account.primary);
      groupRole.appendChild(group);
      groupRole.appendChild(role);
      wrap.appendChild(groupRole);

      const permissions = account.permissions || {};
      const permissionRow = document.createElement('div');
      permissionRow.className = 'account-permissions';
      const canChat = accountPermissionToggle('可聊天', permissions.canChat !== false);
      const canUpload = accountPermissionToggle('可上传', permissions.canUpload !== false);
      const canExecute = accountPermissionToggle('可执行命令', account.primary || permissions.canExecuteCommands === true);
      canExecute.input.disabled = Boolean(account.primary);
      permissionRow.appendChild(canChat.label);
      permissionRow.appendChild(canUpload.label);
      permissionRow.appendChild(canExecute.label);
      wrap.appendChild(permissionRow);

      const modelRow = document.createElement('div');
      modelRow.className = 'account-config-row';
      const provider = document.createElement('select');
      populateAccountProviderOptions(provider, savedTriple.providerProfileId);
      const model = document.createElement('select');
      const modelControl = document.createElement('div');
      modelControl.className = 'account-model-control';
      const refresh = document.createElement('button');
      refresh.type = 'button';
      refresh.className = 'account-model-refresh';
      refresh.textContent = '↻';
      refresh.title = '刷新模型';
      refresh.setAttribute('aria-label', '刷新模型');
      populateAccountModelOptions(model, provider.value, null, savedTriple.model);
      modelControl.appendChild(model);
      modelControl.appendChild(refresh);
      modelRow.appendChild(provider);
      modelRow.appendChild(modelControl);
      wrap.appendChild(modelRow);
      const modelStatus = document.createElement('div');
      modelStatus.className = 'account-model-status';
      wrap.appendChild(modelStatus);

      const effortRow = document.createElement('div');
      effortRow.className = 'account-config-row';
      const effort = document.createElement('select');
      for (const item of ['', 'low', 'medium', 'high', 'xhigh']) {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item || '推理默认';
        effort.appendChild(option);
      }
      effort.value = (account.modelProvider && account.modelProvider.reasoningEffort) || '';
      populateAccountReasoningEffortOptions(effort, null, savedTriple.reasoningEffort);
      const save = document.createElement('button');
      save.className = 'account-config-save';
      save.textContent = '保存权限';
      save.onclick = async () => {
        await patchAccount(account.accountId, {
          group: group.value,
          role: role.value,
          permissions: {
            canChat: canChat.input.checked,
            canUpload: canUpload.input.checked,
            canExecuteCommands: canExecute.input.checked,
          },
          modelProvider: {
            providerProfileId: provider.value,
            model: model.value,
            reasoningEffort: effort.value,
          },
        });
      };
      effortRow.appendChild(effort);
      effortRow.appendChild(save);
      wrap.appendChild(effortRow);

      const rowState = {
        savedTriple,
        provider,
        model,
        effort,
        refresh,
        save,
        status: modelStatus,
        catalog: null,
        loading: false,
        modelLocked: false,
        effortLocked: false,
      };

      async function loadCatalogForCurrentProvider(forceRefresh, useCurrentSelection) {
        const requestedProviderProfileId = provider.value;
        if (!requestedProviderProfileId) {
          rowState.catalog = null;
          rowState.modelLocked = false;
          rowState.effortLocked = false;
          populateAccountModelOptions(model, '', null, '');
          populateAccountReasoningEffortOptions(effort, null, '');
          setAccountModelStatus(modelStatus, '', false);
          setAccountModelControlsLoading(rowState, false);
          updateAccountModelSaveState(rowState);
          return;
        }
        const selectedModel = useCurrentSelection ? model.value : savedTriple.model;
        const selectedEffort = useCurrentSelection ? effort.value : savedTriple.reasoningEffort;
        setAccountModelControlsLoading(rowState, true);
        setAccountModelStatus(
          modelStatus,
          forceRefresh ? '正在刷新模型列表...' : '正在加载模型列表...',
          false,
        );
        try {
          const catalog = await loadProviderModelCatalog(requestedProviderProfileId, forceRefresh);
          if (provider.value !== requestedProviderProfileId) return;
          rowState.catalog = catalog;
          rowState.modelLocked = false;
          rowState.effortLocked = false;
          applyAccountModelCatalog(rowState, catalog, selectedModel, selectedEffort);
          const catalogStatus = accountCatalogStatus(catalog);
          setAccountModelStatus(modelStatus, catalogStatus.text, catalogStatus.warn);
        } catch (_error) {
          if (provider.value !== requestedProviderProfileId) return;
          rowState.catalog = null;
          rowState.modelLocked = true;
          rowState.effortLocked = true;
          populateAccountModelOptions(model, requestedProviderProfileId, null, selectedModel);
          populateAccountReasoningEffortOptions(effort, null, selectedEffort);
          setAccountModelStatus(
            modelStatus,
            forceRefresh ? '模型刷新失败，已保留当前选择' : '模型加载失败，已保留当前选择',
            true,
          );
        } finally {
          if (provider.value !== requestedProviderProfileId) return;
          setAccountModelControlsLoading(rowState, false);
          updateAccountModelSaveState(rowState);
        }
      }

      provider.onchange = () => {
        rowState.catalog = null;
        rowState.modelLocked = false;
        rowState.effortLocked = false;
        populateAccountModelOptions(model, provider.value, null, '');
        populateAccountReasoningEffortOptions(effort, null, '');
        setAccountModelStatus(modelStatus, '', false);
        updateAccountModelSaveState(rowState);
        void loadCatalogForCurrentProvider(false, true);
      };
      model.onchange = () => {
        populateAccountReasoningEffortOptions(
          effort,
          findAccountCatalogModel(rowState.catalog, model.value),
          effort.value,
        );
        updateAccountModelSaveState(rowState);
      };
      effort.onchange = () => updateAccountModelSaveState(rowState);
      refresh.onclick = () => {
        void loadCatalogForCurrentProvider(true, true);
      };
      updateAccountModelSaveState(rowState);
      if (provider.value) {
        void loadCatalogForCurrentProvider(false, false);
      }

      td.appendChild(wrap);
      return td;
    }

    function populateAccountProviderOptions(select, selectedProviderProfileId) {
      const wanted = String(selectedProviderProfileId || '').trim();
      select.textContent = '';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '默认 provider';
      select.appendChild(empty);
      const profiles = Array.isArray(state.providerProfiles) ? state.providerProfiles : [];
      for (const profile of profiles) {
        const id = String(profile.providerProfileId || '').trim();
        if (!id) continue;
        const option = document.createElement('option');
        option.value = id;
        option.textContent = profile.displayName ? (profile.displayName + ' (' + id + ')') : id;
        select.appendChild(option);
      }
      if (wanted && !profiles.some((profile) => profile.providerProfileId === wanted)) {
        const missing = document.createElement('option');
        missing.value = wanted;
        missing.textContent = wanted + ' (未找到)';
        select.appendChild(missing);
      }
      select.value = wanted;
    }

    function populateAccountModelOptions(select, providerProfileId, catalog, selectedModel) {
      const wanted = String(selectedModel || '').trim();
      const seen = new Set();
      const models = Array.isArray(catalog && catalog.models) ? catalog.models : [];
      select.textContent = '';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = providerProfileId ? 'provider 默认模型' : '默认模型';
      select.appendChild(empty);
      for (const modelInfo of models) {
        const modelId = String((modelInfo && (modelInfo.id || modelInfo.model)) || '').trim();
        if (!modelId || seen.has(modelId)) continue;
        seen.add(modelId);
        const option = document.createElement('option');
        option.value = modelId;
        option.textContent = accountModelDisplayText(modelInfo);
        select.appendChild(option);
      }
      if (wanted && !seen.has(wanted)) {
        const missing = document.createElement('option');
        missing.value = wanted;
        missing.textContent = wanted + ' （不可用）';
        select.appendChild(missing);
      }
      select.value = wanted;
    }

    function populateAccountReasoningEffortOptions(select, modelInfo, selectedEffort) {
      const wanted = String(selectedEffort || '').trim();
      const declared = Array.isArray(modelInfo && modelInfo.supportedReasoningEfforts)
        ? modelInfo.supportedReasoningEfforts.slice()
        : [];
      const efforts = declared.length > 0 ? declared : ['low', 'medium', 'high', 'xhigh'];
      select.textContent = '';
      select.title = '支持的推理强度';
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '推理默认';
      select.appendChild(empty);
      for (const effort of efforts) {
        const option = document.createElement('option');
        option.value = effort;
        option.textContent = effort;
        select.appendChild(option);
      }
      if (wanted && !efforts.includes(wanted)) {
        const missing = document.createElement('option');
        missing.value = wanted;
        missing.textContent = wanted + ' （不可用）';
        select.appendChild(missing);
      }
      select.value = wanted;
    }

    function invalidateProviderModelCatalogCache(providerProfileId) {
      const id = String(providerProfileId || '').trim();
      if (!id) return;
      state.providerModelCatalogGenerations.set(
        id,
        (state.providerModelCatalogGenerations.get(id) || 0) + 1,
      );
      state.providerModelCatalogs.delete(id);
      state.providerModelCatalogPromises.delete(id);
    }

    function reloadAccountsAfterProviderChange(providerProfileId, accounts) {
      invalidateProviderModelCatalogCache(providerProfileId);
      if (Array.isArray(accounts)) {
        state.accounts = accounts;
      }
      renderAccounts(Array.isArray(state.accounts) ? state.accounts : []);
    }

    async function loadProviderModelCatalog(providerProfileId, forceRefresh) {
      const id = String(providerProfileId || '').trim();
      if (!id) return null;
      const cached = state.providerModelCatalogs.get(id);
      if (!forceRefresh && cached && Number(cached.expiresAt) > Date.now()) {
        return cached;
      }
      if (!forceRefresh && cached) {
        state.providerModelCatalogs.delete(id);
      }
      if (state.providerModelCatalogPromises.has(id)) {
        return state.providerModelCatalogPromises.get(id);
      }
      const generation = state.providerModelCatalogGenerations.get(id) || 0;
      const suffix = forceRefresh ? '/models/refresh' : '/models';
      const promise = requestJson('/api/provider-profiles/' + encodeURIComponent(id) + suffix, {
        method: forceRefresh ? 'POST' : 'GET'
      }).then((catalog) => {
        if ((state.providerModelCatalogGenerations.get(id) || 0) !== generation) {
          throw new Error('provider model catalog invalidated');
        }
        state.providerModelCatalogs.set(id, catalog);
        return catalog;
      }).finally(() => {
        if (state.providerModelCatalogPromises.get(id) === promise) {
          state.providerModelCatalogPromises.delete(id);
        }
      });
      state.providerModelCatalogPromises.set(id, promise);
      return promise;
    }

    function accountModelDisplayText(modelInfo) {
      const id = String((modelInfo && (modelInfo.id || modelInfo.model)) || '').trim();
      const displayName = String((modelInfo && modelInfo.displayName) || '').trim();
      if (!id) return '';
      return displayName && displayName !== id ? (displayName + ' (' + id + ')') : id;
    }

    function findAccountCatalogModel(catalog, modelId) {
      const wanted = String(modelId || '').trim();
      if (!wanted || !catalog || !Array.isArray(catalog.models)) {
        return null;
      }
      return catalog.models.find((item) => String((item && (item.id || item.model)) || '').trim() === wanted) || null;
    }

    function accountCatalogStatus(catalog) {
      if (!catalog) {
        return { text: '', warn: false };
      }
      const parts = [];
      let warn = false;
      if (catalog.refreshFailed) {
        parts.push('模型刷新失败，使用备用列表');
        warn = true;
      }
      if (catalog.stale) {
        parts.push('已使用缓存模型');
        warn = true;
      } else if (String(catalog.source || '') !== 'provider') {
        parts.push('已使用配置模型');
        warn = true;
      }
      return {
        text: parts.join(' / '),
        warn,
      };
    }

    function setAccountModelStatus(status, text, warn) {
      status.textContent = text || '';
      status.className = warn ? 'account-model-status warn' : 'account-model-status';
    }

    function currentAccountModelTriple(rowState) {
      return {
        providerProfileId: String(rowState.provider.value || '').trim(),
        model: String(rowState.model.value || '').trim(),
        reasoningEffort: String(rowState.effort.value || '').trim(),
      };
    }

    function sameAccountModelTriple(left, right) {
      return left.providerProfileId === right.providerProfileId
        && left.model === right.model
        && left.reasoningEffort === right.reasoningEffort;
    }

    function providerProfileExists(providerProfileId) {
      const wanted = String(providerProfileId || '').trim();
      if (!wanted) return false;
      return (Array.isArray(state.providerProfiles) ? state.providerProfiles : [])
        .some((profile) => String(profile.providerProfileId || '').trim() === wanted);
    }

    function availableReasoningEffortsForModel(modelInfo) {
      const declared = Array.isArray(modelInfo && modelInfo.supportedReasoningEfforts)
        ? modelInfo.supportedReasoningEfforts.slice()
        : [];
      return declared.length > 0 ? declared : ['low', 'medium', 'high', 'xhigh'];
    }

    function canSaveAccountModelSelection(rowState) {
      const current = currentAccountModelTriple(rowState);
      if (sameAccountModelTriple(current, rowState.savedTriple)) {
        return true;
      }
      if (!current.providerProfileId) {
        return !current.model && !current.reasoningEffort;
      }
      if (!providerProfileExists(current.providerProfileId)) {
        return false;
      }
      if (!rowState.catalog) {
        return false;
      }
      if (!current.model) {
        return !current.reasoningEffort || availableReasoningEffortsForModel(null).includes(current.reasoningEffort);
      }
      const modelInfo = findAccountCatalogModel(rowState.catalog, current.model);
      if (!modelInfo) {
        return false;
      }
      return !current.reasoningEffort || availableReasoningEffortsForModel(modelInfo).includes(current.reasoningEffort);
    }

    function syncAccountModelControlState(rowState) {
      rowState.model.disabled = rowState.loading || rowState.modelLocked;
      rowState.effort.disabled = rowState.loading || rowState.effortLocked;
      rowState.refresh.disabled = rowState.loading || !rowState.provider.value;
      rowState.save.disabled = rowState.loading || !canSaveAccountModelSelection(rowState);
    }

    function setAccountModelControlsLoading(rowState, loading) {
      rowState.loading = Boolean(loading);
      syncAccountModelControlState(rowState);
    }

    function updateAccountModelSaveState(rowState) {
      syncAccountModelControlState(rowState);
    }

    function applyAccountModelCatalog(rowState, catalog, selectedModel, selectedEffort) {
      populateAccountModelOptions(rowState.model, rowState.provider.value, catalog, selectedModel);
      populateAccountReasoningEffortOptions(
        rowState.effort,
        findAccountCatalogModel(catalog, rowState.model.value),
        selectedEffort,
      );
    }

    function accountPermissionToggle(text, checked) {
      const label = document.createElement('label');
      label.className = 'account-permission';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(checked);
      const span = document.createElement('span');
      span.textContent = text;
      label.appendChild(input);
      label.appendChild(span);
      return { label, input };
    }

    function statusCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '状态';
      const pill = document.createElement('span');
      pill.className = account.disabled ? 'pill warn' : 'pill ok';
      pill.textContent = account.disabled ? '已禁用' : '监听中';
      td.appendChild(pill);
      return td;
    }

    function actionCell(account) {
      const td = document.createElement('td');
      td.dataset.label = '操作';
      const wrap = document.createElement('div');
      wrap.className = 'actions account-actions';
      if (account.primary) {
        const badge = document.createElement('span');
        badge.className = 'tag-primary';
        badge.textContent = '★ 当前主账号';
        wrap.appendChild(badge);
        td.appendChild(wrap);
        return td;
      }
      const primary = document.createElement('button');
      primary.textContent = '设为主账号';
      primary.onclick = async () => {
        await setPrimaryAccount(account.accountId);
      };
      const toggle = document.createElement('button');
      toggle.textContent = account.disabled ? '启用' : '禁用';
      toggle.onclick = async () => {
        await patchAccount(account.accountId, { disabled: !account.disabled });
      };
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '删除';
      del.onclick = async () => {
        if (!confirm('确认删除这个入口？')) return;
        await requestJson('/api/accounts/' + encodeURIComponent(account.accountId), { method: 'DELETE' });
        await loadState();
      };
      wrap.appendChild(primary);
      wrap.appendChild(toggle);
      wrap.appendChild(del);
      td.appendChild(wrap);
      return td;
    }

    async function setPrimaryAccount(accountId) {
      await requestJson('/api/primary', {
        method: 'POST',
        body: JSON.stringify({ accountId })
      });
      await loadState();
    }

    async function patchAccount(accountId, patch) {
      await requestJson('/api/accounts/' + encodeURIComponent(accountId), {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      await loadState();
    }
