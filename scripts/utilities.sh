#!/bin/bash

# Function to connect to remote VM via SSH
connect_remote() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local terraform_dir="${script_dir}/../terraform"
    
    # Get instance name and zone from Terraform outputs, with defaults
    local instance_name_tf="container-vm"
    local instance_zone_tf="us-central1-a"
    
    # Try to get instance details from Terraform if available
    if [ -f "${terraform_dir}/terraform.tfstate" ]; then
        echo "Getting instance details from Terraform state..."
        instance_name_tf=$(terraform -chdir="${terraform_dir}" output -raw instance_name 2>/dev/null || echo "container-vm")
        instance_zone_tf=$(terraform -chdir="${terraform_dir}" output -raw instance_zone 2>/dev/null || echo "us-central1-a")
    else
        echo "Warning: Could not get instance details from Terraform. Using defaults."
    fi
    
    echo "Connecting to instance '${instance_name_tf}' in zone '${instance_zone_tf}'..."
    echo "Establishing SSH connection..."
    
    # Connect to the instance
    if ! gcloud compute ssh "${instance_name_tf}" --zone="${instance_zone_tf}"; then
        local exit_code=$?
        # Check if it's a normal SSH exit (130 is SIGINT/Ctrl+C)
        if [ $exit_code -eq 130 ]; then
            echo "SSH connection closed normally."
            return 0
        fi
        echo "Error: Failed to establish SSH connection (Exit code: ${exit_code})."
        echo "Possible reasons:"
        echo "1. The VM is not running"
        echo "2. Your gcloud configuration is incorrect"
        echo "3. You don't have the necessary permissions"
        echo "4. The VM is still starting up (wait a few minutes and try again)"
        return 1
    fi
}

# Function to check DNS resolution for a domain
check_dns_resolution() {
    local domain="$1"
    if [ -z "$domain" ]; then
        echo "Error: Domain must be provided to check_dns_resolution." >&2
        return 1
    fi

    echo "Checking DNS resolution for domain: $domain"
    if nslookup "$domain" &>/dev/null; then
        echo "DNS resolution successful for domain: $domain"
        return 0
    else
        echo "DNS resolution failed for domain: $domain"
        return 1
    fi
}

# Function to forcefully clean up Apache environment
apache_nuke() {
    echo "WARNING: This will stop Apache and remove all web files from /var/www/html." >&2
    echo "         This is destructive and cannot be undone." >&2
    read -p "Are you absolutely sure you want to proceed? (y/n): " confirm_nuke
    if [[ ! "$confirm_nuke" =~ ^[Yy] ]]; then
        echo "Apache nuke operation cancelled." >&2
        return 1
    fi

    echo "Proceeding with Apache environment cleanup..."

    # Stop Apache service
    echo "Stopping Apache service..."
    if systemctl is-active --quiet apache2; then
        sudo systemctl stop apache2 || echo "Warning: Failed to stop Apache service." >&2
    else
        echo "Apache service was not running."
    fi

    # Remove web files
    echo "Removing web files from /var/www/html..."
    sudo rm -rf /var/www/html/* || echo "Warning: Failed to remove some web files." >&2

    # Remove any deployment artifacts
    echo "Removing deployment artifacts..."
    sudo rm -rf /tmp/apache_deploy* || echo "Warning: Failed to remove deployment artifacts." >&2

    # Optionally restart Apache with default page
    read -p "Restart Apache with default page? (y/n): " restart_apache
    if [[ "$restart_apache" =~ ^[Yy] ]]; then
        sudo systemctl start apache2 || echo "Warning: Failed to restart Apache." >&2
        echo "Apache restarted with default configuration."
    fi

    echo "Apache environment cleanup completed."
    return 0
}

# Function to backup Apache configuration and web files
backup_apache() {
    local backup_filename="apache_backup_$(date +%Y%m%d_%H%M%S).tar.gz"
    local script_dir; script_dir=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
    local backup_dir="$script_dir/.."

    echo "Creating Apache backup..."

    # Create backup of web files and Apache config
    sudo tar czvf "$backup_dir/$backup_filename" \
        -C /var/www/html . \
        --exclude='*.log' \
        --exclude='tmp' || {
        echo "Error: Failed to create the backup archive '$backup_dir/$backup_filename'." >&2
        return 1
    }

    echo "The backup archive '$backup_dir/$backup_filename' was created successfully."
    return 0
}

# Allow calling functions directly if script is executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "This script (${BASH_SOURCE[0]}) is intended to be sourced. Use the main 'go.sh' script instead." >&2
    exit 1
fi

# Export functions to be available to the main script
# Ensure this list is comprehensive
export -f connect_remote
export -f check_dns_resolution
export -f apache_nuke
export -f backup_apache
# ... any other utility functions ...
