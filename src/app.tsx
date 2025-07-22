/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import React, { useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import {
    DataList,
    DataListItem,
    DataListItemRow,
    DataListItemCells,
    DataListCell
} from "@patternfly/react-core/dist/esm/components/DataList/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";

import {
  Checkbox,
  Dropdown,
  DropdownList,
  DropdownItem,
  Divider,
  MenuToggle,
  MenuToggleElement,
  CardExpandableContent,
  CardHeader,
  CardFooter

} from '@patternfly/react-core';
import EllipsisVIcon from '@patternfly/react-icons/dist/esm/icons/ellipsis-v-icon';


import cockpit from 'cockpit';
import { capitalize } from '@patternfly/react-core';

const _ = cockpit.gettext;


export const Application: React.FC = () => {
    // Configuration
    const SERVICE_NAME = 'aiscot'; // Change this to your service name
    const CONFIG_FILE = `/etc/default/${SERVICE_NAME}`;

    const [isDebugExpanded, setIsDebugExpanded] = useState<boolean>(false);
    const [isConfigExpanded, setIsConfigExpanded] = useState<boolean>(false);


    let originalContent: string = '';
    let environmentVars: Map<string, EnvVarData> = new Map();
    let fileStructure: FileStructureItem[] = []; // Preserves original file structure including comments
    let statusUpdateInterval: number | null = null;
    let logFollowProcess: any = null;

    // Type Definitions
    type EnvVarDefinition = {
        type: 'boolean' | 'string' | 'number' | 'enum' | 'path' | 'url';
        description: string;
        defaultValue: string;
        validation?: RegExp;
        options?: string[];
        range?: [number, number];
        requiresQuoting?: boolean;
        required?: boolean; // Add this line to allow 'required' property
    };

    type EnvVarData = {
        value: string;
        quoted: boolean;
        quoteStyle: 'none' | 'double' | 'single';
        originalLine?: string;
        lineNumber?: number;
        commented: boolean;
        suggested?: boolean;
        required?: boolean; // New field to indicate if the variable is required
    };

    type FileStructureItem = 
        | { type: 'comment'; content: string; lineNumber: number }
        | { type: 'variable'; name: string; lineNumber: number };

    const CONF_PARAMS: Record<string, EnvVarDefinition> = {
        'ENABLED': {
            type: 'boolean',
            description: 'Enable or disable the service',
            defaultValue: 'true',
            validation: /^(true|false|yes|no|1|0)$/i
        },
        
        'COT_URL': {
            type: 'url',
            description: 'URL of the CoT destination, typically Mesh SA or TAK Server',
            defaultValue: 'udp+wo://239.2.3.1:6969',
            validation: /^(udp\+wo|http|https|udp|tcp|tls|file|log|tcp\+wo|udp\+broadcast):\/\/[^\s]+$/,
            requiresQuoting: true,
            required: true
        },

        'LISTEN_PORT': {
            type: 'number',
            description: '(OTA) AIS UDP Listen Port, for use with Over-the-air (RF) AIS decoders',
            defaultValue: '5050',
            validation: /^\d{1,5}$/,
            range: [1, 65535],
            required: false
        },

        'LISTEN_HOST': {
            type: 'string',
            description: '(OTA) IP address to bind to for listening to AIS messages',
            defaultValue: '0.0.0.0',
            validation: /^(\d{1,3}\.){3}\d{1,3}$/,
            required: false
        },

        'FEED_URL': {
            type: 'url',
            description: '(Online) URL of the AIS feed from an AIS aggregator',
            defaultValue: '',
            validation: /^(http|https|file):\/\/[^\s]+$/,
            requiresQuoting: true,
            required: false
        },

        'POLL_INTERVAL': {
            type: 'number',
            description: '(Online) Interval in seconds to poll for new AIS messages from AIS aggregators',
            defaultValue: '61',
            validation: /^\d+$/,
            range: [1, 3600], // 1 second to 1 hour,
            required: false
        },

        'COT_STALE': {
            type: 'number',
            description: 'CoT Stale period ("timeout"), in seconds',
            defaultValue: '3600',
            validation: /^\d+$/,
            required: false
        },

        'COT_TYPE': {
            type: 'string',
            description: 'Override COT Event Type ("marker type")',
            defaultValue: 'a-u-S-X-M',
            validation: /^[a-zA-Z0-9\-_]+$/,
            requiresQuoting: true,
            required: false
        },

        'COT_ICON': {
            type: 'string',
            description: 'Set a custom user icon / custom marker icon in TAK. Contains a Data Package UUID and resource name (file name)',
            defaultValue: '',
            requiresQuoting: true,
            required: false
        },
        
        'KNOWN_CRAFT': {
            type: 'path',
            description: 'CSV-style hints file for overriding callsign, icon, COT Type, etc',
            defaultValue: '',
            validation: /^\/[\w\-\/\.]*$/,
            requiresQuoting: true,
            required: false
        },

        'INCLUDE_ALL_CRAFT': {
            type: 'boolean',
            description: 'If KNOWN_CRAFT is set, include all craft in the CoT, even those not in the KNOWN_CRAFT file.',
            defaultValue: 'true',
            validation: /^(true|false|yes|no|1|0)$/i,
            required: false
        },

        'IGNORE_ATON': {
            type: 'boolean',
            description: 'Ignore AIS from Aids to Navigation (buoys, etc). This is useful if you only want to see ships.',
            defaultValue: 'false',
            validation: /^(true|false|yes|no|1|0)$/i,
            required: false
        },

        'MID_DB_FILE': {
            type: 'path',
            description: 'Path to the MID database file, used for decoding AIS messages',
            defaultValue: '/var/lib/aiscot/mid.db',
            validation: /^\/[\w\-\/\.]*$/,
            requiresQuoting: true,
            required: false
        },

        'SHIP_DB_FILE': {
            type: 'path',
            description: 'Path to the Ship database file, used for decoding AIS messages',
            defaultValue: '/var/lib/aiscot/ship.db',
            validation: /^\/[\w\-\/\.]*$/,
            requiresQuoting: true,   
            required: false
        },

        'LOG_LEVEL': {
            type: 'enum',
            description: 'Logging level',
            defaultValue: 'INFO',
            options: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
            validation: /^(DEBUG|INFO|WARN|ERROR)$/i,
            required: false
        },

        'EXTRA_ARGS': {
            type: 'string',
            description: 'Additional command line arguments (NOT IMPLEMENTED YET)',
            defaultValue: '',
            requiresQuoting: true,
            required: false
        }
    };

    useEffect(() => {
        let watcher: any = null;

        // Function to read and update config file contents
        const updateConfigFileContents = async () => {
            try {
                const content = await cockpit.file(CONFIG_FILE, { superuser: "try"}).read();
                setConfigFileContents(content);
            } catch (err) {
                setConfigFileContents(_("Failed to read configuration file: {error}.").replace("{error}", err.message));
            }
        };

        // Start watching the config file for changes
        watcher = cockpit.file(CONFIG_FILE).watch(updateConfigFileContents);

        // Initial read
        updateConfigFileContents();

        return () => {
            if (watcher && watcher.close) watcher.close();
        };
    }, []);

    const [configFileContents, setConfigFileContents] = useState<string>("");

    // Add state for the CONF_PARAMS form
    const [envVarForm, setEnvVarForm] = useState<Record<string, string>>(
        Object.fromEntries(
            Object.entries(CONF_PARAMS).map(([key, def]) => [key, def.defaultValue])
        )
    );
    
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});

    // Validation helper
    function validateField(key: string, value: string): string {
        const def = CONF_PARAMS[key];
        // Skip validation if not required and value is empty
        if (def.required === false && (value === "" || value == null)) {
            return "";
        }
        if (def.validation && !def.validation.test(value)) {
            return _("Invalid value");
        }
        if (def.type === "number" && def.range) {
            const num = Number(value);
            if (isNaN(num) || num < def.range[0] || num > def.range[1]) {
                return _("Value must be between ") + def.range[0] + " and " + def.range[1];
            }
        }
        if (def.type === "enum" && def.options && !def.options.includes(value)) {
            return _("Invalid option");
        }
        return "";
    }

    // Handle form change
    
    function handleEnvVarChange(key: string, value: string) {
        setEnvVarForm(prev => ({ ...prev, [key]: value }));
        setFormErrors(prev => ({ ...prev, [key]: validateField(key, value) }));
    }

    
    function renderEnvVarForm2(): React.JSX.Element {
        return (
            <form onSubmit={handleEnvVarFormSubmit}>
                <DataList aria-label={_("Environment Variable Configuration")}>
                    {Object.entries(CONF_PARAMS).map(([key, def]) => (
                        <DataListItem key={key} aria-labelledby={`envvar-${key}`}>
                            <DataListItemRow>
                                <DataListItemCells
                                    dataListCells={[
                                        <DataListCell key="label">
                                            <label htmlFor={`envvar-input-${key}`}>
                                                <strong>{key}</strong>
                                                {def.required && (
                                                    <span style={{ color: "red", marginLeft: 8 }}>
                                                        {_("Required")}
                                                    </span>
                                                )}
                                                <div style={{ fontSize: "0.95em", color: "#888" }}>
                                                    {def.description}
                                                </div>
                                                <div style={{ fontSize: "smaller", color: "#888" }}>
                                                    {_("Default")}: <code>{def.defaultValue}</code>
                                                    {def.type === "number" && def.range
                                                        ? ` (${_("Range")}: ${def.range[0]} - ${def.range[1]})`
                                                        : ""}
                                                    {def.type === "enum" && def.options
                                                        ? ` (${_("Options")}: ${def.options.join(", ")})`
                                                        : ""}
                                                </div>
                                            </label>
                                        </DataListCell>,
                                        <DataListCell key="input">
                                            {def.type === "boolean" ? (
                                                <select
                                                    id={`envvar-input-${key}`}
                                                    value={envVarForm[key]}
                                                    onChange={e => handleEnvVarChange(key, e.target.value)}
                                                >
                                                    <option value="true">{_("True")}</option>
                                                    <option value="false">{_("False")}</option>
                                                </select>
                                            ) : def.type === "enum" && def.options ? (
                                                <select
                                                    id={`envvar-input-${key}`}
                                                    value={envVarForm[key]}
                                                    onChange={e => handleEnvVarChange(key, e.target.value)}
                                                >
                                                    {def.options.map(opt => (
                                                        <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    id={`envvar-input-${key}`}
                                                    type={def.type === "number" ? "number" : "text"}
                                                    value={envVarForm[key]}
                                                    min={def.type === "number" && def.range ? def.range[0] : undefined}
                                                    max={def.type === "number" && def.range ? def.range[1] : undefined}
                                                    onChange={e => handleEnvVarChange(key, e.target.value)}
                                                    style={{ width: "300px", fontFamily: "monospace" }}
                                                />
                                            )}
                                            {formErrors[key] && (
                                                <div style={{ color: "red" }}>{formErrors[key]}</div>
                                            )}
                                        </DataListCell>
                                    ]}
                                />
                            </DataListItemRow>
                        </DataListItem>
                    ))}
                </DataList>
                <button type="submit" className="pf-c-button pf-m-primary" style={{ marginTop: "1em", marginBottom: "10em" }}>
                    {_("Validate & Save")}
                </button>
            </form>
        );
    }

    // Handle form submit
    function handleEnvVarFormSubmit(e: React.FormEvent) {
        e.preventDefault();
        // Validate all fields
        const errors: Record<string, string> = {};
        for (const key of Object.keys(CONF_PARAMS)) {
            const err = validateField(key, envVarForm[key]);
            if (err) errors[key] = err;
        }
        setFormErrors(errors);
        if (Object.keys(errors).length === 0) {
            alert(_("All values are valid."));
            
            // You could add logic here to update configFileContents, etc.
            // Example: update the config file with the validated values
            const newConfig = Object.entries(envVarForm)
                .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                .join('\n');

            cockpit.file(CONFIG_FILE, { superuser: "try" }).replace(newConfig)
                .then(() => {
                    setConfigFileContents(newConfig);
                    alert(_("Configuration file updated successfully."));
                })
                .catch((err) => {
                    alert(_("Failed to update configuration file: ") + err.message);
                });
        }
    }

    function ServiceStatus({ serviceName }: { serviceName: string }) {
        const [status, setStatus] = useState<string | null>(null);
        const [error, setError] = useState<string | null>(null);
        useEffect(() => {
            let cancelled = false;
            async function fetchStatus() {
                try {
                    const result = await cockpit
                        .dbus("org.freedesktop.systemd1", {
                            superuser: "try",
                        })
                        .call(
                            "/org/freedesktop/systemd1/unit/" +
                                serviceName.replace(/-/g, "_") +
                                "_2eservice",
                            "org.freedesktop.DBus.Properties",
                            "Get",
                            ["org.freedesktop.systemd1.Unit", "ActiveState"]
                        );
                    if (!cancelled) {
                        setStatus(result[0]?.v || "unknown");
                        setError(null);
                    }
                } catch (e: any) {
                    if (!cancelled) {
                        setError(_("Failed to get service status."));
                        setStatus(null);
                    }
                }
            }
            fetchStatus();
            const interval = setInterval(fetchStatus, 4000);
            return () => {
                cancelled = true;
                clearInterval(interval);
            };
        }, [serviceName]);

        if (error) {
            return <Alert variant="danger" title={error} />;
        }
        if (!status) {
            return <span>{_("Loading...")}</span>;
        }
        let color = "gray";
        if (status === "active") color = "green";
        else if (status === "inactive") color = "red";
        else if (status === "failed") color = "darkred";
        return (
            <span>
                <span
                    style={{
                        display: "inline-block",
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: color,
                        marginRight: 8,
                        verticalAlign: "middle",
                    }}
                />
                {capitalize(status)}
            </span>
        );
    }

    function renderServiceControlButton(
        action: string,
        label: string,
        className: string
    ): React.ReactNode {
        return (
            <button
                className={`pf-c-button ${className}`}
                type="button"
                onClick={async () => {
                    try {
                        await cockpit.spawn(["systemctl", action, SERVICE_NAME], { superuser: "try" });
                        if (action === "enable" || action === "disable") {
                            alert(_(`Service ${label.toLowerCase()}ed.`));
                        }
                    } catch (e) {
                        alert(_(`Failed to ${label.toLowerCase()} service.`));
                    }
                }}
            >
                {label}
            </button>
        );
    }

    const [logsOutput, setLogsOutput] = useState<string>("");

    function showServiceLogs(): void {
        cockpit
            .spawn(["journalctl", "-u", SERVICE_NAME, "--no-pager", "--since", "today"], { superuser: "try" })
            .then((output: string) => {
                setLogsOutput(output || _("No logs found for this service."));
            })
            .catch(() => {
                setLogsOutput(_("Failed to retrieve service logs."));
            });
    }

    function stopFollowingLogs(): void {
        if (logFollowProcess && typeof logFollowProcess.close === "function") {
            logFollowProcess.close();
            logFollowProcess = null;
            setLogsOutput(_("Stopped following logs."));
        } else {
            setLogsOutput(_("Not currently following logs."));
        }
    }

    function followServiceLogs(): void {
        if (logFollowProcess) {
            setLogsOutput(_("Already following logs."));
            return;
        }
        setLogsOutput(""); // Clear previous logs
        logFollowProcess = cockpit.spawn(
            ["journalctl", "-u", SERVICE_NAME, "-f", "--no-pager"],
            { superuser: "try" }
        );
        logFollowProcess.stream((data: string) => {
            setLogsOutput(prev => prev + data);
        });
        logFollowProcess.done(() => {
            logFollowProcess = null;
        });
        logFollowProcess.fail(() => {
            setLogsOutput(_("Failed to follow logs."));
            logFollowProcess = null;
        });
    }

    function StatusOutput({ serviceName }: { serviceName: string }): React.JSX.Element {
        const [statusOutput, setStatusOutput] = React.useState<string>("Loading...");
        React.useEffect(() => {
            let cancelled = false;
            async function fetchStatus() {
                try {
                    const out = await cockpit.spawn(
                        ["systemctl", "status", serviceName, "--no-pager"],
                        { superuser: "try" }
                    );
                    if (!cancelled) setStatusOutput(out);
                } catch {
                    if (!cancelled) setStatusOutput(_("Failed to get status output."));
                }
            }
            fetchStatus();
            const interval = setInterval(fetchStatus, 4000);
            return () => {
                cancelled = true;
                clearInterval(interval);
            };
        }, [serviceName]);
        return (
            <pre
                style={{
                    background: "#222",
                    color: "#eee",
                    padding: "1em",
                    borderRadius: "4px",
                    fontSize: "0.95em",
                    overflowX: "auto",
                    maxHeight: 300,
                }}
            >
                {statusOutput}
            </pre>
        );
    }

    {/* Automatically show and follow logs on mount */}
    {React.useEffect(() => {
        showServiceLogs();
        followServiceLogs();
        // Optionally, clean up on unmount
        return () => {
            stopFollowingLogs();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])}


    // Fetch service docs link and description from systemd unit metadata
    function renderServiceDocsLink(serviceName: string): JSX.Element {
        const [docsUrl, setDocsUrl] = React.useState<string | null>(null);

        React.useEffect(() => {
            let cancelled = false;
            async function fetchDocsUrl() {
                try {
                    // Try to get the Documentation property from systemd unit
                    const result = await cockpit
                        .dbus("org.freedesktop.systemd1", { superuser: "try" })
                        .call(
                            "/org/freedesktop/systemd1/unit/" +
                                serviceName.replace(/-/g, "_") +
                                "_2eservice",
                            "org.freedesktop.DBus.Properties",
                            "Get",
                            ["org.freedesktop.systemd1.Unit", "Documentation"]
                        );
                    if (!cancelled) {
                        // Documentation can be an array or string
                        let doc = result[0]?.v;
                        if (Array.isArray(doc) && doc.length > 0) doc = doc[0];
                        setDocsUrl(typeof doc === "string" && doc ? doc : null);
                    }
                } catch {
                    if (!cancelled) setDocsUrl(null);
                }
            }
            fetchDocsUrl();
            return () => {
                cancelled = true;
            };
        }, [serviceName]);

        const url =
            docsUrl ||
            `https://www.google.com/search?q=${encodeURIComponent(serviceName + " documentation")}`;
        return (
            <a href={url} target="_blank" rel="noopener noreferrer">
                {_("Online Documentation")}
            </a>
        );
    }

    function renderServiceDescription(serviceName: string): React.ReactNode {
        const [description, setDescription] = React.useState<string | null>(null);

        React.useEffect(() => {
            let cancelled = false;
            async function fetchDescription() {
                try {
                    const result = await cockpit
                        .dbus("org.freedesktop.systemd1", { superuser: "try" })
                        .call(
                            "/org/freedesktop/systemd1/unit/" +
                                serviceName.replace(/-/g, "_") +
                                "_2eservice",
                            "org.freedesktop.DBus.Properties",
                            "Get",
                            ["org.freedesktop.systemd1.Unit", "Description"]
                        );
                    if (!cancelled) {
                        setDescription(result[0]?.v || null);
                    }
                } catch {
                    if (!cancelled) setDescription(null);
                }
            }
            fetchDescription();
            return () => {
                cancelled = true;
            };
        }, [serviceName]);

        return (
            <span>
                {description || _("No description available for this service.")}
            </span>
        );
    }

    // Dummy headerActions and isToggleRightAligned for CardHeader props
    const headerActions = undefined;
    const isCardToggleRightAligned = false;

    
    // State for Advanced Details card expansion
    const [isAdvancedDetailsExpanded, setIsAdvancedDetailsExpanded] = useState<boolean>(false);

    // Add this component inside your Application component's return statement
    return (
        <>
            {/* Header Card */}
            <Card>
                <CardTitle>{renderServiceDescription(SERVICE_NAME)}</CardTitle>

                { /* Status, Control & Docs Card */ }
                <CardBody>

                    <CardTitle><ServiceStatus serviceName={SERVICE_NAME} /></CardTitle>

                    <CardTitle>
                    <div style={{ display: "flex", gap: "1em", flexWrap: "wrap" }}>
                        {renderServiceControlButton("start", _("Start"), "pf-m-primary")}
                        {renderServiceControlButton("stop", _("Stop"), "pf-m-secondary")}
                        {renderServiceControlButton("restart", _("Restart"), "pf-m-secondary")}
                        {/* {renderServiceControlButton("reload", _("Reload"), "pf-m-secondary")} */}
                        {renderServiceControlButton("enable", _("Enable"), "pf-m-secondary")}
                        {renderServiceControlButton("disable", _("Disable"), "pf-m-secondary")}
                    </div>
                    </CardTitle>

                    <CardTitle>{renderServiceDocsLink(SERVICE_NAME)}</CardTitle>
                </CardBody>
            </Card>

            {/* Configuration Card */}
            <Card style={{ overflowY: "scroll", maxHeight: "calc(100vh - 200px)" }} isExpanded={isConfigExpanded}>
                <CardHeader
                    className="ct-card-expandable-header"
                    onExpand={() => setIsConfigExpanded(!isConfigExpanded)} 
                    toggleButtonProps={{
                        id: 'expandable-card-toggle',
                        'aria-label': isConfigExpanded ? _('Collapse details') : _('Expand details'),
                    }}
                    isToggleRightAligned={isCardToggleRightAligned}
                >
                    <CardTitle>{_("Configuration")}</CardTitle>
                </CardHeader>

                <CardExpandableContent>
                    {renderEnvVarForm2()}
                </CardExpandableContent>

            </Card>

            {/* Debug Card */}
            <Card isExpanded={isDebugExpanded}>
                <CardHeader
                    className="ct-card-expandable-header"
                    onExpand={() => setIsDebugExpanded(!isDebugExpanded)} 
                    toggleButtonProps={{
                        id: 'expandable-card-toggle',
                        'aria-label': isDebugExpanded ? _('Collapse details') : _('Expand details'),
                    }}
                    isToggleRightAligned={isCardToggleRightAligned}
                >
                    <CardTitle>{_("Debug Logs")}</CardTitle>
                </CardHeader>
                <CardExpandableContent>
                        <CardTitle>{_("Status Output")}</CardTitle>
                        <StatusOutput serviceName={SERVICE_NAME} />

                        <CardTitle>{_("Service Logs")}</CardTitle>
                        <div style={{ display: "flex", gap: "1em", flexWrap: "wrap", marginBottom: "1em" }}>
                            <button
                                className="pf-c-button pf-m-primary"
                                onClick={() => showServiceLogs()}
                            >
                                {_('Show Logs')}
                            </button>
                            <button
                                className="pf-c-button pf-m-secondary"
                                onClick={() => followServiceLogs()}
                            >
                                {_('Follow Logs')}
                            </button>
                            <button
                                className="pf-c-button pf-m-secondary"
                                onClick={() => stopFollowingLogs()}
                            >
                                {_('Stop Following')}
                            </button>
                        </div>
                        <pre
                            style={{
                                background: "#222",
                                color: "#eee",
                                padding: "1em",
                                borderRadius: "4px",
                                fontSize: "0.95em",
                                overflowX: "auto",
                                maxHeight: 300,
                                minHeight: 100,
                            }}
                        >
                            {logsOutput || _("No logs to display.")}
                        </pre>

                </CardExpandableContent>
            </Card>

            <Card isExpanded={isAdvancedDetailsExpanded}>
                <CardHeader
                    className="ct-card-expandable-header"
                    onExpand={() => setIsAdvancedDetailsExpanded(!isAdvancedDetailsExpanded)} 
                    toggleButtonProps={{
                        id: 'expandable-card-toggle',
                        'aria-label': isAdvancedDetailsExpanded ? _('Collapse details') : _('Expand details'),
                    }}
                    isToggleRightAligned={isCardToggleRightAligned}
                >
                    <CardTitle>{_("Advanced Details")}</CardTitle>
                </CardHeader>
                <CardExpandableContent>
                        <div>
                            <strong>{_("Raw Configuration File Contents")}:</strong>
                            <pre
                                style={{
                                    background: "#222",
                                    color: "#eee",
                                    padding: "1em",
                                    borderRadius: "4px",
                                    fontSize: "0.95em",
                                    overflowX: "auto",
                                    maxHeight: 300,
                                    minHeight: 100,
                                }}
                            >
                                {configFileContents}
                            </pre>
                        </div>
                </CardExpandableContent>
            </Card>

        </>
    );
};
