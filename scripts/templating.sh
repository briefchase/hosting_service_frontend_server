#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Function to run templating steps for Firebase deployment
# Accepts: deployment_type, target_dir, overwrite_confirm_result
template_files() {
    local deployment_type="$1"
    local target_dir="$2"
    local overwrite_confirm_result="$3"

    [ -z "$deployment_type" ] && { echo "Error: Deployment type is required for template_files." >&2; return 1; }
    [ -z "$target_dir" ] && { echo "Error: Target directory is required for template_files." >&2; return 1; }

    echo "Running templating steps for '$deployment_type' deployment in $target_dir..." >&2

    # Determine values based on deployment type
    local active_client_id="$CFG_GOOGLE_CLIENT_ID"
    local active_api_url="$CFG_API_BASE_URL"
    local active_log_level="$CFG_LOG_LEVEL"
    local active_grapes_license="$CFG_GRAPESJS_STUDIO_LICENSE"
    
    echo "Generating dynamic config.js for $deployment_type deployment in $target_dir..." >&2
    
    # Ensure the static directory exists in the target
    mkdir -p "$target_dir/static"
    
    # Write the config.js file directly to the target directory
    cat <<EOF > "$target_dir/static/config.js"
// This file is dynamically generated during deployment.
// Do not modify it directly in the build directory.
export const CONFIG = {
    GOOGLE_CLIENT_ID: "$active_client_id",
    API_BASE_URL: "$active_api_url",
    LOG_LEVEL: "$active_log_level",
    GRAPESJS_STUDIO_LICENSE: "$active_grapes_license"
};
EOF

    echo "Templating steps completed successfully." >&2
}

# Allow calling functions directly if script is executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "This script (${BASH_SOURCE[0]}) is intended to be sourced. Use the main 'go.sh' script instead." >&2
    exit 1
fi
