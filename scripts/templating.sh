#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"

# Function to configure terraform.tfvars
# Accepts: overwrite_confirm_result ("y" or "n")
configure_tfvars() {
    local overwrite_confirm_result="$1"
    local project_id=$(get_project_id) # Relies on get_project_id defined in the sourcing script (go.sh)
    local template_file="$SCRIPT_DIR/../templates/terraform.template.tfvars"
    local tfvars_file="$SCRIPT_DIR/../terraform/terraform.tfvars"
    local create_tfvars=false

    [ ! -f "$template_file" ] && { echo "Error: Template '$template_file' not found." >&2; return 1; }

    # Check if terraform.tfvars exists
    if [ ! -f "$tfvars_file" ]; then
        echo "The file '$(basename "$tfvars_file")' does not exist. It will be created." >&2
        create_tfvars=true
    else
        local existing_project_id=$(grep -E '^\s*project_id\s*=' "$tfvars_file" | sed -E 's/^\s*project_id\s*=\s*"(.*)"\s*$/\1/')
        if [ "$existing_project_id" != "$project_id" ]; then
            # Use the passed-in confirmation result
            if [[ "$overwrite_confirm_result" =~ ^[Yy] ]]; then
                 echo "Project ID mismatch detected and overwrite confirmed." >&2
                 create_tfvars=true
            else
                 echo "Project ID mismatch detected, but overwrite was declined. Update of '$(basename "$tfvars_file")' skipped." >&2
            fi
        else
            echo "The project ID in '$(basename "$tfvars_file")' matches the current configuration. No update needed based on project ID." >&2
        fi
    fi

    if [ "$create_tfvars" = true ]; then
        cp "$template_file" "$tfvars_file" || { echo "Error: Copying the template '$(basename "$template_file")' failed." >&2; return 1; }
        sed -i "s/your-project-id/$project_id/g" "$tfvars_file" || { echo "Error: Setting the project ID in '$(basename "$tfvars_file")' failed." >&2; return 1; }
        echo "The file '$(basename "$tfvars_file")' was created/updated with project ID: $project_id." >&2
    fi
    return 0 # Explicitly return success
}



# Function to run templating steps for Apache deployment
# Accepts: deployment_type, target_dir, overwrite_confirm_result
template_files() {
    local deployment_type="$1"
    local target_dir="$2"
    local overwrite_confirm_result="$3"

    [ -z "$deployment_type" ] && { echo "Error: Deployment type is required for template_files." >&2; return 1; }
    [ -z "$target_dir" ] && { echo "Error: Target directory is required for template_files." >&2; return 1; }

    echo "Running templating steps for '$deployment_type' deployment in $target_dir..." >&2

    # Configure Terraform variables only for remote deployments (these are still in the terraform dir)
    if [ "$deployment_type" == "remote" ]; then
        configure_tfvars "$overwrite_confirm_result" || { echo "Error: Failed to configure terraform.tfvars." >&2; return 1; }
    fi

    # Determine values based on deployment type
    local active_client_id=""
    local active_api_url=""
    
    if [ "$deployment_type" == "local" ]; then
        active_client_id="$CFG_LOCAL_GOOGLE_CLIENT_ID"
        active_api_url="$CFG_TEST_API_BASE_URL"
        active_log_level="debug"
    else
        active_client_id="$CFG_PRODUCTION_GOOGLE_CLIENT_ID"
        active_api_url="$CFG_PRODUCTION_API_BASE_URL"
        active_log_level="warn"
    fi

    echo "Generating dynamic config.js for $deployment_type deployment in $target_dir..." >&2
    
    # Ensure the static directory exists in the target
    sudo mkdir -p "$target_dir/static"
    
    # Write the config.js file directly to the target directory
    cat <<EOF | sudo tee "$target_dir/static/config.js" > /dev/null
// This file is dynamically generated during deployment.
// Do not modify it directly in the build directory.
export const CONFIG = {
    GOOGLE_CLIENT_ID: "$active_client_id",
    API_BASE_URL: "$active_api_url",
    LOG_LEVEL: "$active_log_level"
};
EOF

    echo "Templating steps completed successfully." >&2
}

# Allow calling functions directly if script is executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "This script (${BASH_SOURCE[0]}) is intended to be sourced. Use the main 'go.sh' script instead." >&2
    exit 1
fi 