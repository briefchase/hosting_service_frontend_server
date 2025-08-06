# Generate a random suffix for resource names to avoid conflicts
resource "random_id" "suffix" {
  byte_length = 4
}

# Create a VPC network
resource "google_compute_network" "vpc_network" {
  name                    = "apache-network-${random_id.suffix.hex}"
  auto_create_subnetworks = "true"
  project                 = var.project_id
}

# Reserve a static external IP address
resource "google_compute_address" "static_ip" {
  name    = "apache-static-ip-${random_id.suffix.hex}"
  project = var.project_id
}

# Create a service account for registry authentication
resource "google_service_account" "registry_account" {
  account_id   = "apache-auth-sa-${random_id.suffix.hex}"
  display_name = "Service Account for Apache Authentication"
  project      = var.project_id
}

# Create a service account key for registry authentication
resource "google_service_account_key" "registry_key" {
  service_account_id = google_service_account.registry_account.email
  private_key_type   = "TYPE_GOOGLE_CREDENTIALS_FILE"
}

# Create a compute instance
resource "google_compute_instance" "container_vm" {
  name         = "apache-vm-${random_id.suffix.hex}"
  machine_type = "e2-small"
  zone         = var.zone
  project      = var.project_id
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-11"
      size  = 10
    }
  }

  network_interface {
    network = google_compute_network.vpc_network.name
    access_config {
      nat_ip = google_compute_address.static_ip.address
    }
  }

  tags = ["http-server"]

  metadata = {}

  labels = {
    environment = "production"
    managed-by  = "terraform"
    service     = "app-container"
  }

  service_account {
    scopes = ["cloud-platform"]
  }
}

# Create a firewall rule to allow HTTP traffic
resource "google_compute_firewall" "allow_http" {
  name    = "apache-allow-http-${random_id.suffix.hex}"
  network = google_compute_network.vpc_network.name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["http-server"]
}

# Create a firewall rule to allow SSH traffic
resource "google_compute_firewall" "allow_ssh" {
  name    = "apache-allow-ssh-${random_id.suffix.hex}"
  network = google_compute_network.vpc_network.name
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["http-server"]
}

# Create a health check
resource "google_compute_health_check" "http_health_check" {
  name               = "apache-health-check-${random_id.suffix.hex}"
  timeout_sec        = 5
  check_interval_sec = 10
  project            = var.project_id

  http_health_check {
    port = 80
    request_path = "/health"
  }
} 
