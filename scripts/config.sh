#!/bin/bash

# Simple configuration for Apache deployment
export readonly REMOTE_APP_DIR="/var/www/html"

# Get project name from the directory of the main 'go.sh' script
# This makes the config file specific to the project (e.g., website, portfolio)
_PROJECT_NAME=${_GO_SCRIPT_DIR:+"$(basename "$_GO_SCRIPT_DIR")"}
readonly CONFIG_FILE="$HOME/.${_PROJECT_NAME:-default}_deploy_config"
readonly JSON_CONFIG_FILE="$_GO_SCRIPT_DIR/config.json"

# Helper function to get GCP Project ID
get_project_id() {
    gcloud config get-value project 2>/dev/null || echo "(unset)"
}

# Default configuration values
readonly DEFAULT_CONFIRM_APPLY="y"
readonly DEFAULT_LOCAL_HTTP_PORT="8000"
readonly DEFAULT_REMOTE_HTTP_PORT="80"
readonly DEFAULT_REMOTE_HTTPS_PORT="443"
readonly DEFAULT_LOCAL_EXT_URL="localhost"

# Global configuration variables
CFG_SSL_EMAIL=""
CFG_PRODUCTION_EXTERNAL_URL=""
CFG_LOCAL_EXTERNAL_URL="localhost"
CFG_LOCAL_HTTP_PORT=""
CFG_PRODUCTION_HTTP_PORT=""
CFG_PRODUCTION_HTTPS_PORT=""
CFG_CONFIRM_APPLY="n"
CFG_DEPLOYMENT_NAME=""
CFG_LOCAL_GOOGLE_CLIENT_ID=""
CFG_PRODUCTION_GOOGLE_CLIENT_ID=""
CFG_PRODUCTION_API_BASE_URL=""
CFG_TEST_API_BASE_URL=""

# Helper function to check for jq
check_jq() {
    if ! command -v jq &> /dev/null; then
        echo "Error: jq is not installed. Please install jq to manage configuration." >&2
        return 1
    fi
    return 0
}

# Load saved configuration
load_config() {
    if [ -f "$JSON_CONFIG_FILE" ]; then
        if ! check_jq; then return 1; fi
        CFG_SSL_EMAIL=$(jq -r '.ssl_email // ""' "$JSON_CONFIG_FILE")
        CFG_PRODUCTION_EXTERNAL_URL=$(jq -r '.production_external_url // ""' "$JSON_CONFIG_FILE")
        CFG_LOCAL_EXTERNAL_URL=$(jq -r '.local_external_url // "localhost"' "$JSON_CONFIG_FILE")
        CFG_LOCAL_HTTP_PORT=$(jq -r '.local_http_port // "8000"' "$JSON_CONFIG_FILE")
        CFG_PRODUCTION_HTTP_PORT=$(jq -r '.production_http_port // "80"' "$JSON_CONFIG_FILE")
        CFG_PRODUCTION_HTTPS_PORT=$(jq -r '.production_https_port // "443"' "$JSON_CONFIG_FILE")
        CFG_CONFIRM_APPLY=$(jq -r '.confirm_apply // ""' "$JSON_CONFIG_FILE")
        CFG_DEPLOYMENT_NAME=$(jq -r '.deployment_name // ""' "$JSON_CONFIG_FILE")
        CFG_LOCAL_GOOGLE_CLIENT_ID=$(jq -r '.local_google_client_id // ""' "$JSON_CONFIG_FILE")
        CFG_PRODUCTION_GOOGLE_CLIENT_ID=$(jq -r '.production_google_client_id // ""' "$JSON_CONFIG_FILE")
        CFG_PRODUCTION_API_BASE_URL=$(jq -r '.production_api_base_url // "https://api.servercult.com"' "$JSON_CONFIG_FILE")
        CFG_TEST_API_BASE_URL=$(jq -r '.test_api_base_url // "http://localhost:8080"' "$JSON_CONFIG_FILE")
    elif [ -f "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"
    fi
}

# Save configuration
save_config() {
    if ! check_jq; then return 1; fi

    local json_content
    json_content=$(jq -n \
        --arg email "$CFG_SSL_EMAIL" \
        --arg prod_url "$CFG_PRODUCTION_EXTERNAL_URL" \
        --arg local_url "$CFG_LOCAL_EXTERNAL_URL" \
        --arg local_http "$CFG_LOCAL_HTTP_PORT" \
        --arg prod_http "$CFG_PRODUCTION_HTTP_PORT" \
        --arg prod_https "$CFG_PRODUCTION_HTTPS_PORT" \
        --arg apply "$CFG_CONFIRM_APPLY" \
        --arg name "$CFG_DEPLOYMENT_NAME" \
        --arg local_cid "$CFG_LOCAL_GOOGLE_CLIENT_ID" \
        --arg prod_cid "$CFG_PRODUCTION_GOOGLE_CLIENT_ID" \
        --arg prod_api "$CFG_PRODUCTION_API_BASE_URL" \
        --arg test_api "$CFG_TEST_API_BASE_URL" \
        '{ssl_email: $email, production_external_url: $prod_url, local_external_url: $local_url, local_http_port: $local_http, production_http_port: $prod_http, production_https_port: $prod_https, confirm_apply: $apply, deployment_name: $name, local_google_client_id: $local_cid, production_google_client_id: $prod_cid, production_api_base_url: $prod_api, test_api_base_url: $test_api}')
    
    echo "$json_content" > "$JSON_CONFIG_FILE"
    echo "Configuration saved to $JSON_CONFIG_FILE"

    # Remove the old config file if it exists to avoid conflicts
    if [ -f "$CONFIG_FILE" ]; then
        rm "$CONFIG_FILE"
        echo "Removed old configuration file: $CONFIG_FILE"
    fi
}

# Simple configuration for local Apache deployment
configure_local_deployment() {
    # Load existing config first to avoid nuking other values
    load_config
    
    CFG_LOCAL_EXTERNAL_URL="${CFG_LOCAL_EXTERNAL_URL:-$DEFAULT_LOCAL_EXT_URL}"
    
    # Prompt for Local HTTP Port
    if [ -n "$CFG_LOCAL_HTTP_PORT" ]; then
        read -p "Enter Local HTTP Port [$CFG_LOCAL_HTTP_PORT]: " local_port_input
        CFG_LOCAL_HTTP_PORT="${local_port_input:-$CFG_LOCAL_HTTP_PORT}"
    else
        CFG_LOCAL_HTTP_PORT="$DEFAULT_LOCAL_HTTP_PORT"
        read -p "Enter Local HTTP Port [$CFG_LOCAL_HTTP_PORT]: " local_port_input
        CFG_LOCAL_HTTP_PORT="${local_port_input:-$CFG_LOCAL_HTTP_PORT}"
    fi
    
    # Prompt for Local Google Client ID
    if [ -n "$CFG_LOCAL_GOOGLE_CLIENT_ID" ]; then
        read -p "Enter Local Google Client ID [$CFG_LOCAL_GOOGLE_CLIENT_ID]: " local_cid_input
        CFG_LOCAL_GOOGLE_CLIENT_ID="${local_cid_input:-$CFG_LOCAL_GOOGLE_CLIENT_ID}"
    else
        read -p "Enter Local Google Client ID: " CFG_LOCAL_GOOGLE_CLIENT_ID
    fi

    # Prompt for Local API Base URL
    if [ -n "$CFG_TEST_API_BASE_URL" ]; then
        read -p "Enter Test API Base URL [$CFG_TEST_API_BASE_URL]: " test_api_input
        CFG_TEST_API_BASE_URL="${test_api_input:-$CFG_TEST_API_BASE_URL}"
    else
        read -p "Enter Test API Base URL: " CFG_TEST_API_BASE_URL
    fi
    
    echo "Local Apache deployment configured."
    save_config
}

# Simple configuration for remote Apache deployment
configure_remote_deployment() {
    local main_script_dir="$1"
    
    # Load saved configuration
    load_config
    
    # First, ensure GCP configuration is set up
    echo "Setting up GCP configuration..."
    check_gcp || { echo "Error: GCP setup failed." >&2; return 1; }
    
    local project_id=$(get_project_id)
    echo "Using GCP project: $project_id"
    
    # Prompt for SSL email (use saved value as default)
    if [ -n "$CFG_SSL_EMAIL" ]; then
        read -p "Enter SSL email for Let's Encrypt [$CFG_SSL_EMAIL]: " ssl_email_input
        CFG_SSL_EMAIL="${ssl_email_input:-$CFG_SSL_EMAIL}"
    else
        read -p "Enter SSL email for Let's Encrypt: " CFG_SSL_EMAIL
        while [ -z "$CFG_SSL_EMAIL" ]; do
            echo "Error: SSL email cannot be empty for remote deployment."
            read -p "Enter SSL email: " CFG_SSL_EMAIL
        done
    fi
    
    # Prompt for external URL/domain (use saved value as default)
    if [ -n "$CFG_PRODUCTION_EXTERNAL_URL" ]; then
        local use_saved_input
        read -p "Use saved domain/URL ($CFG_PRODUCTION_EXTERNAL_URL)? (y/n) [default: y]: " use_saved_input
        local use_saved="${use_saved_input:-y}"
        
        if [[ ! "$use_saved" =~ ^[Yy]$ ]]; then
            CFG_PRODUCTION_EXTERNAL_URL=""
        fi
    fi
    
    if [ -z "$CFG_PRODUCTION_EXTERNAL_URL" ]; then
        local use_domain_input
        read -p "Use domain for URL? (y/n) [default: n]: " use_domain_input
        local use_domain="${use_domain_input:-n}"

        if [[ "$use_domain" =~ ^[Yy]$ ]]; then
            read -p "Enter domain(s) (comma-separated): " CFG_PRODUCTION_EXTERNAL_URL
            while [ -z "$CFG_PRODUCTION_EXTERNAL_URL" ]; do
                echo "Error: Domain cannot be empty."
                read -p "Enter domain(s) (comma-separated): " CFG_PRODUCTION_EXTERNAL_URL
            done
        else
            # Try to get IP from Terraform
            local tf_state_file="$main_script_dir/terraform/terraform.tfstate"
            local terraform_dir="$main_script_dir/terraform"
            local tf_ip=""
            
            if command -v terraform &>/dev/null && [ -f "$tf_state_file" ]; then
                tf_ip=$(cd "$terraform_dir" && terraform output -raw instance_public_ip 2>/dev/null) || tf_ip=""
            fi
            
            if [ -n "$tf_ip" ]; then
                local use_tf_ip_input
                read -p "Use detected Terraform IP ($tf_ip)? (y/n) [default: y]: " use_tf_ip_input
                local use_tf_ip="${use_tf_ip_input:-y}"
                
                if [[ "$use_tf_ip" =~ ^[Yy]$ ]]; then
                    CFG_PRODUCTION_EXTERNAL_URL="$tf_ip"
                fi
            fi
            
            if [ -z "$CFG_PRODUCTION_EXTERNAL_URL" ]; then
                read -p "Enter external IP or domain(s) (comma-separated): " CFG_PRODUCTION_EXTERNAL_URL
                while [ -z "$CFG_PRODUCTION_EXTERNAL_URL" ]; do
                    echo "Error: External URL cannot be empty."
                    read -p "Enter external IP or domain(s) (comma-separated): " CFG_PRODUCTION_EXTERNAL_URL
                done
            fi
        fi
    fi
    
    # Set ports
    if [ -n "$CFG_PRODUCTION_HTTP_PORT" ]; then
        read -p "Enter Production HTTP Port [$CFG_PRODUCTION_HTTP_PORT]: " prod_http_input
        CFG_PRODUCTION_HTTP_PORT="${prod_http_input:-$CFG_PRODUCTION_HTTP_PORT}"
    else
        CFG_PRODUCTION_HTTP_PORT="$DEFAULT_REMOTE_HTTP_PORT"
        read -p "Enter Production HTTP Port [$CFG_PRODUCTION_HTTP_PORT]: " prod_http_input
        CFG_PRODUCTION_HTTP_PORT="${prod_http_input:-$CFG_PRODUCTION_HTTP_PORT}"
    fi

    if [ -n "$CFG_PRODUCTION_HTTPS_PORT" ]; then
        read -p "Enter Production HTTPS Port [$CFG_PRODUCTION_HTTPS_PORT]: " prod_https_input
        CFG_PRODUCTION_HTTPS_PORT="${prod_https_input:-$CFG_PRODUCTION_HTTPS_PORT}"
    else
        CFG_PRODUCTION_HTTPS_PORT="$DEFAULT_REMOTE_HTTPS_PORT"
        read -p "Enter Production HTTPS Port [$CFG_PRODUCTION_HTTPS_PORT]: " prod_https_input
        CFG_PRODUCTION_HTTPS_PORT="${prod_https_input:-$CFG_PRODUCTION_HTTPS_PORT}"
    fi
    
    # Confirm Terraform apply
    local apply_input
    read -p "Apply Terraform plan? (y/n) [default: ${DEFAULT_CONFIRM_APPLY}]: " apply_input
    CFG_CONFIRM_APPLY="${apply_input:-$DEFAULT_CONFIRM_APPLY}"
    [[ "$CFG_CONFIRM_APPLY" =~ ^[Yy]$ ]] && CFG_CONFIRM_APPLY="y" || CFG_CONFIRM_APPLY="n"
    
    # Prompt for Production Google Client ID
    if [ -n "$CFG_PRODUCTION_GOOGLE_CLIENT_ID" ]; then
        read -p "Enter Production Google Client ID [$CFG_PRODUCTION_GOOGLE_CLIENT_ID]: " prod_cid_input
        CFG_PRODUCTION_GOOGLE_CLIENT_ID="${prod_cid_input:-$CFG_PRODUCTION_GOOGLE_CLIENT_ID}"
    else
        read -p "Enter Production Google Client ID: " CFG_PRODUCTION_GOOGLE_CLIENT_ID
    fi

    # Prompt for Production API Base URL
    if [ -n "$CFG_PRODUCTION_API_BASE_URL" ]; then
        read -p "Enter Production API Base URL [$CFG_PRODUCTION_API_BASE_URL]: " prod_api_input
        CFG_PRODUCTION_API_BASE_URL="${prod_api_input:-$CFG_PRODUCTION_API_BASE_URL}"
    else
        read -p "Enter Production API Base URL: " CFG_PRODUCTION_API_BASE_URL
    fi
    
    # Save configuration
    save_config
    
    echo "Remote Apache deployment configured."
}

# Main configuration function
# Args: $1 main_script_dir, $2 deployment_type
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
    echo "=== Apache Deployment Configuration ==="
    echo "Deployment Name: $CFG_DEPLOYMENT_NAME"
    echo "Production External URL: $CFG_PRODUCTION_EXTERNAL_URL"
    echo "Local External URL: $CFG_LOCAL_EXTERNAL_URL"
    echo "Production HTTP Port: $CFG_PRODUCTION_HTTP_PORT"
    echo "Production HTTPS Port: $CFG_PRODUCTION_HTTPS_PORT"
    echo "Local HTTP Port: $CFG_LOCAL_HTTP_PORT"
    echo "Production API Base URL: $CFG_PRODUCTION_API_BASE_URL"
    echo "Test API Base URL: $CFG_TEST_API_BASE_URL"
    echo "SSL Email: $CFG_SSL_EMAIL"
    echo "Confirm Apply: $CFG_CONFIRM_APPLY"
    echo "================================="
}

# Allow calling functions directly if script is executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "This script (${BASH_SOURCE[0]}) is intended to be sourced. Use the main 'go.sh' script instead." >&2
    exit 1
fi
