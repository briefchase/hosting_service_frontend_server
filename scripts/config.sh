#!/bin/bash

# Configuration for Firebase Hosting deployment with target-specific variables

_PROJECT_NAME=${_GO_SCRIPT_DIR:+"$(basename "$_GO_SCRIPT_DIR")"}
readonly JSON_CONFIG_FILE="$_GO_SCRIPT_DIR/config.json"

# Helper function to get GCP Project ID
get_project_id() {
    gcloud config get-value project 2>/dev/null || echo "(unset)"
}

# Global configuration variables (Master)
CFG_SSL_EMAIL=""
CFG_LOCAL_HTTP_PORT=""
CFG_DEPLOYMENT_NAME=""
CFG_GCP_PROJECT_ID=""
CFG_LAST_DEPLOYMENT_TARGET=""

# Target-specific variables (Populated from vars_<target>.json)
CFG_EXTERNAL_URL=""
CFG_GOOGLE_CLIENT_ID=""
CFG_API_BASE_URL=""
CFG_LOG_LEVEL=""
CFG_DEPLOYMENT_TARGET=""

# Helper function to check for jq
check_jq() {
    if ! command -v jq &> /dev/null; then
        echo "Error: jq is not installed. Please install jq to manage configuration." >&2
        return 1
    fi
    return 0
}

# Load saved configuration
# Arg $1: deployment_type ("local" or "remote")
load_config() {
    local deployment_type="$1"
    if ! check_jq; then return 1; fi

    if [ -f "$JSON_CONFIG_FILE" ]; then
        CFG_SSL_EMAIL=$(jq -r '.ssl_email // ""' "$JSON_CONFIG_FILE")
        CFG_LOCAL_HTTP_PORT=$(jq -r '.local_http_port // "8000"' "$JSON_CONFIG_FILE")
        CFG_DEPLOYMENT_NAME=$(jq -r '.deployment_name // ""' "$JSON_CONFIG_FILE")
        CFG_GCP_PROJECT_ID=$(jq -r '.gcp_project_id // "hoster-server"' "$JSON_CONFIG_FILE")
        CFG_LAST_DEPLOYMENT_TARGET=$(jq -r '.last_deployment_target // "local"' "$JSON_CONFIG_FILE")
    fi

    # Determine deployment target
    if [ "$deployment_type" == "remote" ]; then
        local target_prompt="${CFG_LAST_DEPLOYMENT_TARGET}"
        [ "$target_prompt" == "local" ] || [ -z "$target_prompt" ] && target_prompt="production"
        
        while true; do
            read -p "Enter deployment target (e.g., production, test) [$target_prompt]: " target_input
            CFG_DEPLOYMENT_TARGET="${target_input:-$target_prompt}"
            if [ -f "$_GO_SCRIPT_DIR/vars_${CFG_DEPLOYMENT_TARGET}.json" ]; then
                break
            else
                echo "Error: Target configuration file not found at $_GO_SCRIPT_DIR/vars_${CFG_DEPLOYMENT_TARGET}.json" >&2
            fi
        done
    else
        CFG_DEPLOYMENT_TARGET="local"
    fi

    local target_json="$_GO_SCRIPT_DIR/vars_${CFG_DEPLOYMENT_TARGET}.json"
    if [ ! -f "$target_json" ]; then
        echo "Error: Target configuration file not found at $target_json" >&2
        return 1
    fi

    echo "Loading target configuration from $target_json..."
    CFG_EXTERNAL_URL=$(jq -r '.external_url // ""' "$target_json")
    CFG_GOOGLE_CLIENT_ID=$(jq -r '.google_client_id // ""' "$target_json")
    CFG_API_BASE_URL=$(jq -r '.api_base_url // ""' "$target_json")
    CFG_LOG_LEVEL=$(jq -r '.log_level // "INFO"' "$target_json")

    # Update last deployment target in master config
    CFG_LAST_DEPLOYMENT_TARGET="$CFG_DEPLOYMENT_TARGET"
    save_config
}

# Save configuration
save_config() {
    if ! check_jq; then return 1; fi

    # Save Master Config
    local master_json
    master_json=$(jq -n \
        --arg email "$CFG_SSL_EMAIL" \
        --arg local_http "$CFG_LOCAL_HTTP_PORT" \
        --arg name "$CFG_DEPLOYMENT_NAME" \
        --arg gcp_project "$CFG_GCP_PROJECT_ID" \
        --arg last_target "$CFG_LAST_DEPLOYMENT_TARGET" \
        '{ssl_email: $email, local_http_port: $local_http, deployment_name: $name, gcp_project_id: $gcp_project, last_deployment_target: $last_target}')
    echo "$master_json" > "$JSON_CONFIG_FILE"

    # Save Target-Specific Config
    local target_json_file="$_GO_SCRIPT_DIR/vars_${CFG_DEPLOYMENT_TARGET}.json"
    if [ -f "$target_json_file" ]; then
        local target_json
        target_json=$(jq -n \
            --arg ext_url "$CFG_EXTERNAL_URL" \
            --arg google_cid "$CFG_GOOGLE_CLIENT_ID" \
            --arg api_base "$CFG_API_BASE_URL" \
            --arg log_lvl "$CFG_LOG_LEVEL" \
            '{external_url: $ext_url, google_client_id: $google_cid, api_base_url: $api_base, log_level: $log_lvl}')
        echo "$target_json" > "$target_json_file"
    fi
}

# Simple configuration for local deployment
configure_local_deployment() {
    # load_config is now called by go.sh, so we just prompt for changes if needed
    read -p "Enter Local HTTP Port [$CFG_LOCAL_HTTP_PORT]: " local_port_input
    CFG_LOCAL_HTTP_PORT="${local_port_input:-$CFG_LOCAL_HTTP_PORT}"
    
    read -p "Enter Local Google Client ID [$CFG_GOOGLE_CLIENT_ID]: " local_cid_input
    CFG_GOOGLE_CLIENT_ID="${local_cid_input:-$CFG_GOOGLE_CLIENT_ID}"

    read -p "Enter Local API Base URL [$CFG_API_BASE_URL]: " local_api_input
    CFG_API_BASE_URL="${local_api_input:-$CFG_API_BASE_URL}"
    
    read -p "Enter Log Level [$CFG_LOG_LEVEL]: " log_lvl_input
    CFG_LOG_LEVEL="${log_lvl_input:-$CFG_LOG_LEVEL}"

    echo "Local deployment configured."
    save_config
}

# Simple configuration for remote deployment
configure_remote_deployment() {
    local main_script_dir="$1"
    
    echo "Using GCP project: $CFG_GCP_PROJECT_ID"
    
    read -p "Enter SSL email for Let's Encrypt [$CFG_SSL_EMAIL]: " ssl_email_input
    CFG_SSL_EMAIL="${ssl_email_input:-$CFG_SSL_EMAIL}"
    while [ -z "$CFG_SSL_EMAIL" ]; do
        echo "Error: SSL email cannot be empty for remote deployment."
        read -p "Enter SSL email: " CFG_SSL_EMAIL
    done
    
    read -p "Enter domain(s) (comma-separated) [$CFG_EXTERNAL_URL]: " ext_url_input
    CFG_EXTERNAL_URL="${ext_url_input:-$CFG_EXTERNAL_URL}"
    while [ -z "$CFG_EXTERNAL_URL" ]; do
        echo "Error: Domain cannot be empty."
        read -p "Enter domain(s) (comma-separated): " CFG_EXTERNAL_URL
    done
    
    read -p "Enter Google Client ID [$CFG_GOOGLE_CLIENT_ID]: " prod_cid_input
    CFG_GOOGLE_CLIENT_ID="${prod_cid_input:-$CFG_GOOGLE_CLIENT_ID}"

    read -p "Enter API Base URL [$CFG_API_BASE_URL]: " prod_api_input
    CFG_API_BASE_URL="${prod_api_input:-$CFG_API_BASE_URL}"

    read -p "Enter Log Level [$CFG_LOG_LEVEL]: " log_lvl_input
    CFG_LOG_LEVEL="${log_lvl_input:-$CFG_LOG_LEVEL}"

    read -p "Enter GCP Project ID [$CFG_GCP_PROJECT_ID]: " gcp_project_input
    CFG_GCP_PROJECT_ID="${gcp_project_input:-$CFG_GCP_PROJECT_ID}"
    
    save_config
    echo "Remote deployment configured for target: $CFG_DEPLOYMENT_TARGET"
}

# Main configuration function
configure_deployment() {
    local main_script_dir="$1"
    local deployment_type="$2"
    
    case "$deployment_type" in
        "local")
            configure_local_deployment
            ;;
        "remote")
            configure_remote_deployment "$main_script_dir"
            ;;
        *)
            echo "Error: Invalid deployment type '$deployment_type'."
            return 1
            ;;
    esac
}

# Simple function to display current configuration
show_configuration() {
    echo "=== Firebase Deployment Configuration ==="
    echo "Target: $CFG_DEPLOYMENT_TARGET"
    echo "Deployment Name: $CFG_DEPLOYMENT_NAME"
    echo "External URL: $CFG_EXTERNAL_URL"
    echo "API Base URL: $CFG_API_BASE_URL"
    echo "Google Client ID: $CFG_GOOGLE_CLIENT_ID"
    echo "Log Level: $CFG_LOG_LEVEL"
    echo "Local HTTP Port: $CFG_LOCAL_HTTP_PORT"
    echo "GCP Project ID: $CFG_GCP_PROJECT_ID"
    echo "SSL Email: $CFG_SSL_EMAIL"
    echo "================================="
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "This script (${BASH_SOURCE[0]}) is intended to be sourced. Use the main 'go.sh' script instead." >&2
    exit 1
fi
