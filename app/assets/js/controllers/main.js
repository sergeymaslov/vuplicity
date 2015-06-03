/**
 * Main controller
 */
(function(m, require)
{

    'use strict';

    var ipc = require('ipc');
    var dialog = require('dialog');
    var moment = require('moment');
    var events = require('events');
    var Configuration = require(__dirname + '/../utils/configuration.js');
    var WindowRenderer = require(__dirname + '/../utils/windowrenderer.js');
    var Duplicity = require(__dirname + '/../utils/duplicity.js');
    var Scheduler = require(__dirname + '/../utils/scheduler.js');

    var module = {};

    var appTray = null;
    var duplicityHelpers = {};
    var controlPanelWindow = null;
    var appConfig = null;

    /**
     * Inits main controller
     * @param panel_path
     * @param config_path
     * @param tray
     */
    module.init = function(panel_path, config_path, tray)
    {
        appTray = tray;
        appConfig = new Configuration(config_path);
        controlPanelWindow = new WindowRenderer();
        controlPanelWindow.load(panel_path);
        _initIPC.apply(this);
    };

    /**
     * Displays the main control panel
     */
    module.showControlPanel = function()
    {
        controlPanelWindow.makeVisible();
    };

    /**
     * Inits IPC events
     */
    var _initIPC = function()
    {
        ipc.on('control-panel-ready', _onControlPanelReady.bind(this));
        ipc.on('request-backup-deletion', _onRequestBackupDeletion.bind(this));
        ipc.on('select-directory', _onSelectBackupDirectory.bind(this));
        ipc.on('refresh-file-tree', _onRefreshBackupFileTree.bind(this));
        ipc.on('refresh-status', _onRefreshBackupStatus.bind(this));
        ipc.on('save-settings', _onSaveBackupSettings.bind(this));
        ipc.on('cancel-process', _onCancelBackupProcess.bind(this));
        ipc.on('restore-file', _onRestoreBackupFile.bind(this));
        ipc.on('restore-all', _onRestoreBackupTree.bind(this));
        ipc.on('start-backup', _onStartBackup.bind(this));
    };

    /**
     * Sends the current configuration to the control panel when it has been opened, and inits scheduler
     */
    var _onControlPanelReady = function()
    {
        var backups = appConfig.getBackups();
        for (var index in backups)
        {
            duplicityHelpers[index] = new Duplicity(index);
            duplicityHelpers[index].onOutput(_onDuplicityOutput.bind(this));
            duplicityHelpers[index].setData(backups[index]);
            controlPanelWindow.send('set-backup-options', index, backups[index], false);
            Scheduler.updateBackup(index, backups[index]);
        }
        Scheduler.onScheduledEvent(_onScheduledEvent.bind(this));
    };

    /**
     * Cancels the current process of a backup
     * @param evt
     * @param backup_id
     */
    var _onCancelBackupProcess = function(evt, backup_id)
    {
        duplicityHelpers[backup_id].cancel();
    };

    /**
     * Triggers a scheduled event
     * @param backup_id
     */
    var _onScheduledEvent = function(backup_id)
    {
        console.log('@todo start backup if not already running');
    };

    /**
     * Starts a backup task
     * @param evt
     * @param backup_id
     */
    var _onStartBackup = function(evt, backup_id)
    {
        var params = {
            type: 'info',
            message: 'What task do you want to start ?',
            buttons: ['Automatic backup', 'Full backup']
        };
        dialog.showMessageBox(controlPanelWindow.getWindow(), params, function(response)
        {
            _setBackupUI.apply(this, [backup_id, 'processing', 'Backup in progress...']);
            duplicityHelpers[backup_id].doBackup((response === 0 ? '' : 'full'), function(error, status)
            {
                controlPanelWindow.send('set-backup-status', backup_id, status);
                _setBackupUI.apply(this, [backup_id, 'idle', error ? error : 'Backup done.']);
                if (!error)
                {
                    _onRefreshBackupStatus.apply(this, [null, backup_id]);
                }
            });
        });
    };

    /**
     * Opens a file dialog to select a backup dir from the control panel
     * @param evt
     * @param backup_id
     */
    var _onSelectBackupDirectory = function(evt, backup_id)
    {
        dialog.showOpenDialog(controlPanelWindow.getWindow(), {title: 'Select directory', properties: ['openDirectory']}, function(paths)
        {
            if (typeof paths !== 'undefined')
            {
                controlPanelWindow.send('set-backup-path', paths[0], backup_id);
            }
        });
    };

    /**
     * Request the deletion of a backup from the control panel
     * @param evt
     * @param backup_id
     */
    var _onRequestBackupDeletion = function(evt, backup_id)
    {
        var params = {
            type: 'warning',
            message: 'Do you want to delete this backup ?',
            detail: 'The entry will be removed.\nNothing will be modified on the remote server.',
            buttons: ['Delete', 'Cancel']
        };
        dialog.showMessageBox(controlPanelWindow.getWindow(), params, function(response)
        {
            if (response === 0)
            {
                _setBackupUI.apply(this, [backup_id, 'processing', 'Deleting backup...']);
                appConfig.deleteBackup(backup_id, function(error)
                {
                    if (error === false)
                    {
                        controlPanelWindow.send('confirm-backup-deletion', backup_id);
                        delete duplicityHelpers[backup_id];
                    }
                    else
                    {
                        _setBackupUI.apply(this, [backup_id, 'idle', error]);
                    }
                });
            }
        });
    };

    /**
     * Gets the status of a backup
     * @param evt
     * @param backup_id
     */
    var _onRefreshBackupStatus = function(evt, backup_id)
    {
        _setBackupUI.apply(this, [backup_id, 'processing', 'Refreshing status...']);
        duplicityHelpers[backup_id].getStatus(function(error, status)
        {
            controlPanelWindow.send('set-backup-status', backup_id, status);
            _setBackupUI.apply(this, [backup_id, 'idle', error ? error : 'Status updated.']);
        });
    };

    /**
     * Gets the file tree of a backup
     * @param evt
     * @param backup_id
     */
    var _onRefreshBackupFileTree = function(evt, backup_id)
    {
        _setBackupUI.apply(this, [backup_id, 'processing', 'Refreshing file tree...']);
        duplicityHelpers[backup_id].getFiles(function(error, tree)
        {
            controlPanelWindow.send('set-backup-file-tree', backup_id, tree);
            _setBackupUI.apply(this, [backup_id, 'idle', error ? error : 'Files refreshed.']);
        });
    };

    /**
     * Saves the options of a backup
     * @param evt
     * @param backup_id
     * @param backup_data
     */
    var _onSaveBackupSettings = function(evt, backup_id, backup_data)
    {
        _setBackupUI.apply(this, [backup_id, 'processing', 'Saving settings...']);
        appConfig.updateBackup(backup_id, backup_data, function(error)
        {
            _setBackupUI.apply(this, [backup_id, 'idle', error ? error : 'Settings saved.']);
            if (error === false)
            {
                controlPanelWindow.send('set-backup-options', backup_id, backup_data, false);
                Scheduler.updateBackup(backup_id, backup_data);
                duplicityHelpers[backup_id].setData(backup_data);
            }
        });
    };

    /**
     * Restores the file of a backup
     * @param evt
     * @param backup_id
     * @param path
     */
    var _onRestoreBackupFile = function(evt, backup_id, path)
    {
        var backup_data = appConfig.getBackupData(backup_id);
        var params = {
            title: 'Select the restore destination',
            defaultPath: backup_data.path
        };
        dialog.showSaveDialog(controlPanelWindow.getWindow(), params, function(destination_path)
        {
            if (typeof destination_path !== 'undefined')
            {
                _setBackupUI.apply(this, [backup_id, 'processing', 'Restoring file...']);
                duplicityHelpers[backup_id].restoreFile(path, destination_path, function(error)
                {
                    _setBackupUI.apply(this, [backup_id, 'idle', error ? error : 'File restored.']);
                });
            }
        });
    };

    /**
     * Restores a backup
     * @param evt
     * @param backup_id
     */
    var _onRestoreBackupTree = function(evt, backup_id)
    {
        var backup_data = appConfig.getBackupData(backup_id);
        var params = {
            title: 'Select the restore destination',
            defaultPath: backup_data.path,
            properties: ['openDirectory', 'createDirectory']
        };
        dialog.showOpenDialog(controlPanelWindow.getWindow(), params, function(destination_path)
        {
            if (typeof destination_path !== 'undefined')
            {
                _setBackupUI.apply(this, [backup_id, 'processing', 'Restoring all files...']);
                duplicityHelpers[backup_id].restoreTree(destination_path, function(error)
                {
                    _setBackupUI.apply(this, [backup_id, 'idle', error ? error : 'Backup tree restored.']);
                });
            }
        });
    };

    /**
     * Sends Duplicity output to the backup view
     * @param backup_id
     * @param output
     */
    var _onDuplicityOutput = function(backup_id, output)
    {
        controlPanelWindow.send('set-backup-history', backup_id, output);
    };

    /**
     * Updates backup UI when doing tasks
     * @param backup_id
     * @param state
     * @param message
     */
    var _setBackupUI = function(backup_id, state, message)
    {
        appTray[state === 'processing' ? 'setProcessing' : 'setIdle']();
        controlPanelWindow.send('set-backup-ui', backup_id, state, message);
        message = moment().format('YYYY-MM-DD HH:mm:ss') + '\n' + message;
        controlPanelWindow.send('set-backup-history', backup_id, message);
    };

    m.exports = module;

})(module, require);